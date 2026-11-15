// Admin panel: signs phone verification links in the browser.
// The private key is held in memory only and never stored or sent.
const $ = (selector, parent = document) => parent.querySelector(selector);
const { subtle } = window.crypto;
const DIRECTORY_KEY = 'puma-admin-directory';
const LEGACY_KEY = 'puma-admin-links';
let privateJwk = null;

const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }
};
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

function applyTheme() {
  const theme = storage.get('puma-theme', 'light');
  document.documentElement.dataset.theme = theme;
  $('meta[name="theme-color"]').content = theme === 'dark' ? '#0c1217' : '#f7f5ef';
}

function showToast(title, detail) {
  const toast = $('#toast');
  $('b', toast).textContent = title;
  $('small', toast).textContent = detail;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function setKeyState(state, title, detail) {
  $('#keyStatus').innerHTML = `<b>${escapeHTML(title)}</b><span>${escapeHTML(detail)}</span>`;
  $('#keyStatus').classList.toggle('verified', state === 'ok');
  $('#keyTag').textContent = state === 'ok' ? 'LISTA' : 'SIN CARGAR';
  $('#keyForget').hidden = state !== 'ok';
  $('#signButton').disabled = state !== 'ok';
}

// Prove the loaded private key matches the public key the site publishes.
async function useKey(text) {
  privateJwk = null;
  let jwk;
  try { jwk = JSON.parse(text); } catch { setKeyState('error', 'El archivo no es JSON válido', 'Usa el archivo clave-privada.json que creó el script.'); return; }
  if (jwk?.kty !== 'EC' || jwk?.crv !== 'P-256' || !jwk?.d) { setKeyState('error', 'Eso no es una clave privada', 'Debe ser una clave EC P-256 con el campo "d".'); return; }
  if (!window.PUMA_PUBLIC_KEY) { setKeyState('error', 'Falta la clave pública del sitio', 'Genera tus claves con el script y publica clave-publica.js.'); return; }
  try {
    const probe = '+56900000000';
    const signature = await PumaDomain.signPhone(probe, jwk, subtle);
    const matches = await PumaDomain.verifyPhone(probe, signature, window.PUMA_PUBLIC_KEY, subtle);
    if (!matches) { setKeyState('error', 'La clave no coincide con el sitio', 'Los enlaces firmados con ella serían rechazados. Revisa que clave-publica.js esté actualizado.'); return; }
  } catch { setKeyState('error', 'No se pudo leer la clave', 'El archivo parece dañado.'); return; }
  privateJwk = jwk;
  $('#keyText').value = '';
  setKeyState('ok', '✓ Clave cargada y comprobada', 'Coincide con la clave pública del sitio. Ya puedes generar enlaces.');
}

// Directory of people who received a code. Names come from pasted requests,
// so everything rendered here is escaped.
function loadDirectory() {
  let list = storage.get(DIRECTORY_KEY, []);
  const legacy = storage.get(LEGACY_KEY, null);
  if (Array.isArray(legacy) && legacy.length) {
    legacy.forEach(item => { list = PumaDomain.upsertDirectory(list, { phone:item.phone }, item.date); });
    storage.set(DIRECTORY_KEY, list);
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* storage unavailable */ }
  }
  return list;
}
const shortDate = value => new Date(value).toLocaleString('es-CL', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
function renderDirectory() {
  const all = loadDirectory();
  const shown = PumaDomain.searchDirectory(all, $('#directorySearch').value).sort((a, b) => b.lastSentAt.localeCompare(a.lastSentAt));
  $('#directoryCount').textContent = all.length ? `· ${all.length}` : '';
  $('#exportCSV').disabled = $('#exportBackup').disabled = !all.length;
  $('#directoryList').innerHTML = !all.length
    ? '<p class="transfer-empty">Aún no generas códigos. Cada persona aparecerá aquí al generarle el suyo.</p>'
    : !shown.length
      ? '<p class="transfer-empty">Nadie coincide con esa búsqueda.</p>'
      : `<table><thead><tr><th>Usuario</th><th>Teléfono</th><th>Billetera</th><th>Primer código</th><th>Último código</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>${shown.map(item => `<tr><td>${item.name ? escapeHTML(item.name) : '<span class="admin-muted">Sin nombre</span>'}</td><td>${escapeHTML(item.phone)}</td><td class="admin-mono">${item.wallet ? escapeHTML(PumaDomain.formatWallet(item.wallet)) : '<span class="admin-muted">—</span>'}</td><td>${escapeHTML(shortDate(item.firstSentAt))}</td><td>${escapeHTML(shortDate(item.lastSentAt))}</td><td><button class="text-button admin-remove" type="button" data-remove="${escapeHTML(item.phone)}" aria-label="Quitar ${escapeHTML(item.name || item.phone)} del directorio">Quitar</button></td></tr>`).join('')}</tbody></table>`;
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href:url, download:name });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const today = () => new Date().toISOString().slice(0, 10);

$('#keyFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (file) await useKey(await file.text());
  event.target.value = '';
});
$('#keyPasteButton').addEventListener('click', () => useKey($('#keyText').value));
$('#keyForget').addEventListener('click', () => {
  privateJwk = null;
  $('#signResult').hidden = true;
  setKeyState('none', 'Clave olvidada', 'Vuelve a cargarla para generar enlaces.');
});

$('#signPhone').addEventListener('input', () => {
  const raw = $('#signPhone').value.trim();
  const phone = PumaDomain.normalizePhone(raw);
  const known = phone && loadDirectory().find(item => item.phone === phone);
  $('#signPhoneHint').textContent = !raw ? 'Incluye el código de país.' : !phone ? 'Número no válido: incluye el código de país (+).' : known ? `Se firmará como ${phone}. Ya está en el directorio${known.name ? ` como ${known.name}` : ''}.` : `Se firmará como ${phone}`;
});
$('#signRequest').addEventListener('input', () => {
  const request = PumaDomain.parseVerificationRequest($('#signRequest').value);
  if (!request) { $('#signRequestHint').textContent = $('#signRequest').value.trim() ? 'No reconocí una solicitud. Completa los campos a mano.' : 'Se llenan solos el usuario, la billetera y el teléfono.'; return; }
  // Replace every field so nothing from the previous person carries over.
  $('#signName').value = request.name;
  $('#signWallet').value = PumaDomain.formatWallet(request.wallet);
  $('#signPhone').value = request.phone ?? '';
  $('#signPhone').dispatchEvent(new Event('input'));
  const missing = [!request.name && 'usuario', !request.wallet && 'billetera', !request.phone && 'teléfono'].filter(Boolean);
  const walletOwner = request.wallet && loadDirectory().find(item => item.wallet === request.wallet && item.phone !== request.phone);
  $('#signRequestHint').textContent = walletOwner
    ? `Ojo: esa billetera ya está registrada con ${walletOwner.phone}.`
    : missing.length ? `Leí la solicitud, pero falta: ${missing.join(', ')}.` : 'Solicitud leída. Revisa que el número sea el mismo desde el que te escribió.';
});

$('#signForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#signError').textContent = '';
  const phone = PumaDomain.normalizePhone($('#signPhone').value);
  if (!privateJwk) { $('#signError').textContent = 'Carga primero tu clave privada.'; return; }
  if (!phone) { $('#signError').textContent = 'Ingresa un teléfono válido con código de país.'; return; }
  let site;
  try { site = new URL($('#signSite').value).href; } catch { $('#signError').textContent = 'La dirección del sitio no es válida.'; return; }
  const signature = await PumaDomain.signPhone(phone, privateJwk, subtle);
  const link = PumaDomain.verificationLink(site, phone, signature);
  const message = `Hola, tu código de verificación de PumaMarket es:\n\n${signature}\n\nCópialo y pégalo en "Ingresar código". También puedes abrir este enlace: ${link}`;
  $('#resultCode').textContent = signature;
  $('#resultPhone').textContent = phone;
  $('#resultLink').value = message;
  $('#whatsappLink').href = `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`;
  $('#smsLink').href = `sms:${phone}?body=${encodeURIComponent(message)}`;
  $('#signResult').hidden = false;
  storage.set(DIRECTORY_KEY, PumaDomain.upsertDirectory(loadDirectory(), { phone, name:$('#signName').value.trim(), wallet:$('#signWallet').value }));
  renderDirectory();
  // Clear the form so the next request starts empty.
  ['#signRequest', '#signName', '#signWallet', '#signPhone'].forEach(selector => { $(selector).value = ''; });
  $('#signRequestHint').textContent = 'Se llenan solos el usuario, la billetera y el teléfono.';
  $('#signPhoneHint').textContent = 'Incluye el código de país.';
});

$('#copyCode').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#resultCode').textContent); showToast('Código copiado', 'Pégalo en el chat con ese número.'); }
  catch { showToast('No se pudo copiar', 'Selecciona el código y cópialo a mano.'); }
});
$('#copyLink').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#resultLink').value); showToast('Mensaje copiado', 'Pégalo en el chat con ese número.'); }
  catch { $('#resultLink').select(); showToast('No se pudo copiar', 'El texto quedó seleccionado: cópialo a mano.'); }
});
$('#directorySearch').addEventListener('input', renderDirectory);
$('#directoryList').addEventListener('click', event => {
  const phone = event.target.closest('[data-remove]')?.dataset.remove;
  if (!phone || !window.confirm(`¿Quitar ${phone} del directorio? Su verificación en el sitio no cambia.`)) return;
  storage.set(DIRECTORY_KEY, loadDirectory().filter(item => item.phone !== phone));
  renderDirectory();
});
$('#exportCSV').addEventListener('click', () => {
  // The byte-order mark makes Excel read accents correctly.
  download(`pumamarket-directorio-${today()}.csv`, `﻿${PumaDomain.directoryCSV(loadDirectory())}`, 'text/csv;charset=utf-8');
});
$('#exportBackup').addEventListener('click', () => {
  download(`pumamarket-directorio-${today()}.json`, JSON.stringify({ version:1, exportedAt:new Date().toISOString(), directory:loadDirectory() }, null, 2), 'application/json');
});
$('#importBackup').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  let entries;
  try { entries = JSON.parse(await file.text()).directory; } catch { entries = null; }
  if (!Array.isArray(entries)) { showToast('No se pudo restaurar', 'Usa un archivo de respaldo descargado desde este panel.'); return; }
  let list = loadDirectory();
  const before = list.length;
  // Merge: keep the earliest first code and the latest last code per phone.
  for (const item of entries) {
    if (!PumaDomain.normalizePhone(item?.phone) || Number.isNaN(Date.parse(item.firstSentAt)) || Number.isNaN(Date.parse(item.lastSentAt))) continue;
    const current = list.find(entry => entry.phone === PumaDomain.normalizePhone(item.phone));
    const latest = [item.lastSentAt, current?.lastSentAt ?? ''].sort().at(-1);
    list = PumaDomain.upsertDirectory(list, { phone:item.phone, name:String(item.name ?? '').slice(0, 24), wallet:item.wallet }, latest);
    const merged = list.find(entry => entry.phone === PumaDomain.normalizePhone(item.phone));
    if (item.firstSentAt < merged.firstSentAt) merged.firstSentAt = item.firstSentAt;
  }
  storage.set(DIRECTORY_KEY, list);
  renderDirectory();
  const added = list.length - before;
  showToast('Directorio restaurado', `${added} ${added === 1 ? 'persona nueva' : 'personas nuevas'}, ${list.length} en total.`);
});

// Password gate. Static hosting means this hides the panel rather than
// securing it; signing still requires the private key file.
const UNLOCK_KEY = 'puma-admin-unlocked';
function setLocked(locked) {
  $('#adminGate').hidden = !locked;
  $('#adminContent').hidden = locked;
  $('#adminLock').hidden = locked;
  if (locked) setTimeout(() => $('#gatePassword').focus(), 50);
}
function initGate() {
  const access = window.PUMA_ADMIN_ACCESS;
  if (!access) {
    $('#gatePassword').disabled = $('#gateButton').disabled = true;
    $('#gateNote').innerHTML = 'Aún no configuraste la contraseña. En tu terminal, desde la carpeta del proyecto, ejecuta <code>node tools/verificar-telefono.js contrasena</code> y sube el archivo <code>admin-acceso.js</code>.';
    setLocked(true);
    return;
  }
  let unlocked = false;
  try { unlocked = sessionStorage.getItem(UNLOCK_KEY) === access.hash; } catch { /* storage unavailable */ }
  setLocked(!unlocked);
}
$('#gateForm').addEventListener('submit', async event => {
  event.preventDefault();
  const access = window.PUMA_ADMIN_ACCESS;
  const button = $('#gateButton');
  if (!access || button.disabled) return;
  button.disabled = true;
  button.innerHTML = 'Comprobando…';
  $('#gateError').textContent = '';
  const ok = await PumaDomain.checkAdminPassword($('#gatePassword').value, access, subtle);
  if (ok) {
    try { sessionStorage.setItem(UNLOCK_KEY, access.hash); } catch { /* storage unavailable */ }
    $('#gatePassword').value = '';
    setLocked(false);
  } else {
    // A short pause makes guessing by hand tedious.
    await new Promise(resolve => setTimeout(resolve, 1200));
    $('#gateError').textContent = 'Contraseña incorrecta.';
    $('#gatePassword').select();
  }
  button.disabled = false;
  button.innerHTML = 'Entrar <span>→</span>';
});
$('#adminLock').addEventListener('click', () => {
  try { sessionStorage.removeItem(UNLOCK_KEY); } catch { /* storage unavailable */ }
  privateJwk = null;
  $('#signResult').hidden = true;
  setKeyState('none', 'Sin clave', 'Carga clave-privada.json desde tu carpeta .pumamarket para empezar.');
  setLocked(true);
});

applyTheme();
initGate();
$('#signSite').value = new URL('./', location.href).href;
setKeyState('none', 'Sin clave', 'Carga clave-privada.json desde tu carpeta .pumamarket para empezar.');
renderDirectory();
