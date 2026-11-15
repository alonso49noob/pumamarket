// Admin panel: signs phone verification links in the browser.
// The private key is held in memory only and never stored or sent.
const $ = (selector, parent = document) => parent.querySelector(selector);
const { subtle } = window.crypto;
const HISTORY_KEY = 'puma-admin-links';
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

function renderHistory() {
  const items = storage.get(HISTORY_KEY, []);
  $('#historyList').innerHTML = items.length
    ? `<ul class="transfer-list">${[...items].reverse().map(item => `<li><span>${escapeHTML(item.phone)}<small>${escapeHTML(new Date(item.date).toLocaleString('es-CL'))}</small></span></li>`).join('')}</ul>`
    : '<p class="transfer-empty">Aún no generas enlaces.</p>';
  $('#historyClear').hidden = !items.length;
}

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
  $('#signPhoneHint').textContent = !raw ? 'Incluye el código de país.' : phone ? `Se firmará como ${phone}` : 'Número no válido: incluye el código de país (+).';
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
  const message = `Hola, este es tu enlace para verificar tu teléfono en PumaMarket: ${link}`;
  $('#resultPhone').textContent = phone;
  $('#resultLink').value = message;
  $('#whatsappLink').href = `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`;
  $('#smsLink').href = `sms:${phone}?body=${encodeURIComponent(message)}`;
  $('#signResult').hidden = false;
  const history = storage.get(HISTORY_KEY, []).filter(item => item.phone !== phone);
  storage.set(HISTORY_KEY, [...history, { phone, date:new Date().toISOString() }]);
  renderHistory();
});

$('#copyLink').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#resultLink').value); showToast('Mensaje copiado', 'Pégalo en el chat con ese número.'); }
  catch { $('#resultLink').select(); showToast('No se pudo copiar', 'El texto quedó seleccionado: cópialo a mano.'); }
});
$('#historyClear').addEventListener('click', () => {
  if (!window.confirm('¿Borrar la lista de enlaces generados de este navegador?')) return;
  storage.set(HISTORY_KEY, []);
  renderHistory();
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
renderHistory();
