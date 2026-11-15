const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const $ = (selector, parent = document) => parent.querySelector(selector);

const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};

let user = storage.get('puma-user', null);
let account = storage.get('puma-account', null);
let accounts = storage.get('puma-accounts', []);
// Import the original single-account prototype once, preserving its activity.
if (!accounts.length && account) {
  accounts = [{ ...account, id:crypto.randomUUID(), balance:storage.get('puma-balance', PumaDomain.STARTING_POINTS), predictions:storage.get('puma-predictions', []) }];
  storage.set('puma-accounts', accounts);
}
const randomBytes = size => crypto.getRandomValues(new Uint8Array(size));
// Accounts created before wallets existed get their address once.
if (accounts.some(item => !PumaDomain.normalizeWallet(item.wallet))) {
  accounts = PumaDomain.assignWallets(accounts, randomBytes);
  storage.set('puma-accounts', accounts);
}
// Supply log: one entry each time the points in circulation change.
function recordSupply(reason) {
  const log = storage.get('puma-supply', []);
  const next = PumaDomain.logSupply(log, PumaDomain.circulating(storage.get('puma-accounts', [])), new Date().toISOString(), log.length ? reason : 'inicio');
  if (next !== log) storage.set('puma-supply', next);
  return next;
}
recordSupply('ajuste');
account = user ? accounts.find(item => item.id === user.id || (!user.id && item.name === user.name)) : null;
user = account ? { id:account.id, name:account.name } : null;
storage.set('puma-user', user);
let authMode = accounts.length ? 'login' : 'register';
let selectedMarketId = '';
let selectedMarket = '';
let selectedChoice = 'Sí';
let balance = account?.balance ?? PumaDomain.STARTING_POINTS;
let markets = storage.get('puma-markets', []);
let pendingAction = null;
let activeCategory = 'Todos';
let modalTrigger = null;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const points = value => `${Number(value).toLocaleString('es-CL')} P`;
const dateLabel = value => new Date(value).toLocaleDateString('es-CL', { day:'numeric', month:'short', year:'numeric' });
const isClosed = market => Boolean(market?.resolution) || new Date(`${market?.deadline}T23:59:59`) <= new Date();
const outcomeLabel = market => market.resolution ? `Resuelto · ${market.resolution.outcome}` : null;
function saveAccount() {
  if (!account) return;
  accounts = accounts.map(item => item.id === account.id ? account : item);
  storage.set('puma-accounts', accounts);
}
function myPredictions() { return account?.predictions ?? []; }
function ownMarkets() { return markets.filter(item => item.ownerId ? item.ownerId === user?.id : item.author === user?.name); }

const signInButton = $('#signInButton');
const authModal = $('#authModal');
const predictionModal = $('#predictionModal');
const toast = $('#toast');

async function passwordHash(password) {
  if (!window.crypto?.subtle) return btoa(unescape(encodeURIComponent(password)));
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function toggleModal(modal, shouldOpen) {
  if (shouldOpen) modalTrigger = document.activeElement;
  modal.classList.toggle('open', shouldOpen);
  modal.setAttribute('aria-hidden', String(!shouldOpen));
  document.body.classList.toggle('modal-open', Boolean($('.modal-backdrop.open')));
  if (shouldOpen) setTimeout(() => $('input, button', modal)?.focus(), 100);
  else modalTrigger?.focus();
}

function formatBalance() { return `${balance.toLocaleString('es-CL')} P`; }

function setSignedInUI() {
  signInButton.textContent = user ? `${user.name} ↗` : 'Iniciar sesión ↗';
  signInButton.classList.toggle('signed-in', Boolean(user));
  signInButton.setAttribute('title', user ? 'Abrir mi cuenta' : 'Iniciar sesión');
  renderDashboard();
  if (currentDetail) renderDetail();
}

function configureAuth() {
  const isReturning = authMode === 'login';
  $('#authTitle').textContent = isReturning ? 'Qué bueno verte de nuevo.' : 'Tu próxima buena intuición empieza aquí.';
  $('#authNote').innerHTML = isReturning
    ? 'Ingresa tus datos para volver a tus mercados y puntos Puma.'
    : `Crea una sesión para guardar tus predicciones y recibir <b>${PumaDomain.STARTING_POINTS.toLocaleString('es-CL')} puntos Puma</b>. Son virtuales: no tienen valor monetario.`;
  $('#authSubmit').innerHTML = `${isReturning ? 'Iniciar sesión' : 'Crear acceso'} <span>→</span>`;
  $('#userName').value = '';
  $('#userName').readOnly = false;
  $('#phoneLabel').hidden = isReturning;
  $('#userPhone').required = !isReturning;
  $('#userPhone').value = '';
  $('#authError').textContent = '';
  $('#authModeSwitch').hidden = false;
  $('#authModeSwitch').textContent = isReturning ? '¿Primera vez? Crear cuenta' : 'Ya tengo cuenta · Iniciar sesión';
  $('#userPassword').value = '';
  $('#userPassword').setAttribute('autocomplete', isReturning ? 'current-password' : 'new-password');
  $('#resetRequest').hidden = true;
  $('#authForm').hidden = false;
  $('#showReset').hidden = !isReturning;
}

function showToast(message = 'Predicción registrada', description = 'Tus puntos Puma se actualizaron.') {
  $('b', toast).textContent = message;
  $('small', toast).textContent = description;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

signInButton.addEventListener('click', () => {
  if (user && account) {
    $('#accountName').textContent = account.name;
    $('#accountPhone').value = account.phone ?? '';
    $('#accountError').textContent = '';
    toggleModal($('#accountModal'), true); return;
  }
  if (user && !account) { user = null; storage.set('puma-user', null); }
  configureAuth();
  toggleModal(authModal, true);
});

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const isReturning = authMode === 'login';
  const name = $('#userName').value.trim();
  const password = $('#userPassword').value;
  const phoneValue = $('#userPhone').value;
  $('#authError').textContent = '';
  if (name.length < 2 || password.length < 4) { $('#authError').textContent = 'Ingresa un nombre y una contraseña válidos.'; return; }
  $('#authSubmit').disabled = true;
  try {
    const hash = await passwordHash(password);
    // Re-read after hashing to include registrations in other tabs.
    accounts = storage.get('puma-accounts', []);
    let matched = accounts.find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (isReturning) {
      if (!matched || matched.passwordHash !== hash) { $('#authError').textContent = 'Usuario o contraseña incorrectos.'; return; }
    } else {
      const error = PumaDomain.phoneError(phoneValue, accounts);
      if (error) { $('#authError').textContent = error; return; }
      if (matched) { $('#authError').textContent = 'Este nombre de usuario ya existe. Elige otro.'; return; }
      matched = { id:crypto.randomUUID(), name, phone:PumaDomain.normalizePhone(phoneValue), passwordHash:hash, balance:PumaDomain.STARTING_POINTS, predictions:[], wallet:PumaDomain.newWallet(accounts, randomBytes), transfers:[] };
      accounts.push(matched);
      storage.set('puma-accounts', accounts);
      recordSupply('nueva cuenta');
    }
    account = matched;
  } finally {
    $('#authSubmit').disabled = false;
  }
  balance = account.balance;
  user = { id:account.id, name:account.name };
  storage.set('puma-user', user);
  toggleModal(authModal, false);
  setSignedInUI();
  showToast(isReturning ? `Bienvenido de vuelta, ${user.name}` : `Bienvenido, ${user.name}`, isReturning ? 'Tu sesión está lista para continuar.' : 'Tu acceso está listo. Tus puntos Puma son virtuales.');
  const action = pendingAction;
  pendingAction = null;
  if (action) action();
});
$('#authModeSwitch').addEventListener('click', () => { authMode = authMode === 'login' ? 'register' : 'login'; configureAuth(); });

$('#showReset').addEventListener('click', () => {
  $('#authForm').hidden = true;
  $('#showReset').hidden = true;
  $('#authModeSwitch').hidden = true;
  $('#resetUserName').value = account?.name ?? $('#userName').value;
  $('#resetRequest').hidden = false;
  $('#resetUserName').focus();
});

$('#backToLogin').addEventListener('click', configureAuth);

$('#resetForm').addEventListener('submit', event => {
  event.preventDefault();
  const requests = storage.get('puma-reset-requests', []);
  requests.push({ username: $('#resetUserName').value.trim(), message: $('#resetMessage').value.trim(), requestedAt: new Date().toISOString(), status: 'pendiente' });
  storage.set('puma-reset-requests', requests);
  toggleModal(authModal, false);
  showToast('Solicitud guardada localmente', 'No se envió a un servidor. La recuperación requiere conectar un backend.');
});

$$('[data-close]').forEach(button => button.addEventListener('click', () => { pendingAction = null; toggleModal($(`#${button.dataset.close}`), false); }));
$$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) { pendingAction = null; toggleModal(backdrop, false); } }));

function requireUser(action) {
  if (user) { action(); return; }
  pendingAction = action;
  configureAuth();
  toggleModal(authModal, true);
}

function openPrediction(card, choice = 'Sí') {
  requireUser(() => {
    const market = detailData(card);
    if (market && isClosed(market)) { showToast('Mercado cerrado', market.resolution ? 'Esta pregunta ya tiene resultado.' : 'La fecha de cierre de esta pregunta ya pasó.'); return; }
    selectedMarket = $('h3', card).textContent;
    selectedMarketId = card.dataset.id;
    $('#marketQuestion').textContent = selectedMarket;
    selectedChoice = choice;
    $$('.choice').forEach(item => { item.classList.toggle('active', item.dataset.choice === choice); item.setAttribute('aria-pressed', String(item.dataset.choice === choice)); });
    $('#balanceLabel').textContent = formatBalance();
    const maximum = Math.min(500, Math.floor(balance / 25) * 25);
    $('#stakeRange').max = Math.max(25, maximum);
    $('#stakeRange').value = Math.min(100, Math.max(25, maximum));
    $('#stakeRange').disabled = maximum < 25;
    $('#stakeValue').textContent = maximum < 25 ? '0' : $('#stakeRange').value;
    $('#confirmPrediction').disabled = maximum < 25;
    if (maximum < 25) showToast('Puntos insuficientes', 'Necesitas al menos 25 puntos para predecir.');
    toggleModal(predictionModal, true);
  });
}
$('#marketGrid').addEventListener('click', event => {
  const button = event.target.closest('.predict-button');
  const card = event.target.closest('.market-card');
  if (button) openPrediction(card);
  else if (card) { event.preventDefault(); location.hash = `mercado/${card.dataset.id}`; }
});

$$('.choice').forEach(button => button.addEventListener('click', () => {
  $$('.choice').forEach(item => item.classList.remove('active'));
  button.classList.add('active'); selectedChoice = button.dataset.choice;
  $$('.choice').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));

$('#stakeRange').addEventListener('input', event => $('#stakeValue').textContent = event.target.value);

$('#confirmPrediction').addEventListener('click', () => {
  const stake = Number($('#stakeRange').value);
  if (!user || !selectedMarket || !Number.isFinite(stake) || stake < 25 || stake % 25 !== 0) return;
  const selectedCard = $$('.market-card').find(card => card.dataset.id === selectedMarketId);
  const market = selectedCard ? detailData(selectedCard) : null;
  if (market && isClosed(market)) { toggleModal(predictionModal, false); showToast('Mercado cerrado', 'Esta pregunta ya no admite predicciones.'); return; }
  if (stake > balance) { showToast('Puntos insuficientes', 'Elige una cantidad menor para tu predicción.'); return; }
  balance -= stake;
  account.balance = balance;
  account.predictions.push({ marketId:selectedMarketId, market: selectedMarket, choice: selectedChoice, stake, date: new Date().toISOString() });
  saveAccount();
  renderMarkets();
  renderDashboard();
  renderPulse();
  if (currentDetail) renderDetail();
  toggleModal(predictionModal, false);
  showToast('Predicción registrada', `${selectedChoice} · ${stake} puntos Puma en juego.`);
});

$$('.category').forEach(button => button.addEventListener('click', () => {
  activeCategory = button.dataset.category;
  filterMarkets();
}));

$$('.topic').forEach(topic => topic.addEventListener('click', () => {
  activeCategory = $('b', topic).textContent === 'El mundo' ? 'Mundo' : $('b', topic).textContent;
  $('#searchInput').value = '';
  filterMarkets();
  $('#mercados').scrollIntoView({ behavior:'smooth' });
}));

$('#howItWorks').addEventListener('click', () => document.querySelector('.principles').scrollIntoView({ behavior: 'smooth' }));
const searchPanel = $('#searchPanel');
$('.search-toggle').addEventListener('click', () => { searchPanel.classList.toggle('open'); if (searchPanel.classList.contains('open')) $('#searchInput').focus(); });
$('#searchInput').addEventListener('input', event => {
  filterMarkets();
  if (currentDetail) location.hash = 'mercados';
  $('#mercados').scrollIntoView({ behavior:'smooth' });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { pendingAction = null; $$('.modal-backdrop.open').forEach(modal => toggleModal(modal, false)); searchPanel.classList.remove('open'); }
  const modal = $('.modal-backdrop.open');
  if (event.key === 'Tab' && modal) {
    const elements = $$('button:not([disabled]), input:not([disabled]), select, textarea, a[href]', modal).filter(item => item.getClientRects().length);
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

function resultLabel(item) {
  if (item.result === 'won') return `Acertaste · +${points(item.payout)}`;
  if (item.result === 'lost') return 'No acertaste · puntos perdidos';
  return 'Registrada · sin resultado aún';
}

function renderDashboard() {
  const predictions = user ? myPredictions() : [];
  $('#dashboardTitle').textContent = user ? `Hola, ${user.name}. Esta es tu mirada.` : 'Tu próxima idea cuenta.';
  $('#dashboardSubtitle').textContent = user ? 'Tus puntos, tus preguntas y cada decisión, en un solo lugar.' : 'Inicia sesión para guardar tus predicciones y seguir tu actividad.';
  $('#logoutButton').hidden = !user;
  $('#statBalance').textContent = user ? points(balance) : '—';
  $('#statStaked').textContent = user ? points(predictions.filter(item => !item.result).reduce((sum, item) => sum + item.stake, 0)) : '—';
  $('#statPredictions').textContent = user ? predictions.length : '—';
  $('#statCreated').textContent = user ? ownMarkets().length : '—';
  $('#predictionHistory').innerHTML = predictions.length ? `<div class="history-scroll"><table><thead><tr><th>Mercado</th><th>Tu lectura</th><th>Puntos</th><th>Fecha</th></tr></thead><tbody>${[...predictions].reverse().map(item => `<tr><td>${escapeHTML(item.market)}<small class="${item.result ? `result-${item.result}` : ''}">${resultLabel(item)}</small></td><td><span class="choice-pill ${item.choice === 'No' ? 'negative' : ''}">${escapeHTML(item.choice)}</span></td><td>${points(item.stake)}</td><td>${dateLabel(item.date)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><span class="empty-icon">↗</span><h4>${user ? 'Tu primera lectura está por llegar.' : 'Una mirada propia empieza aquí.'}</h4><p>${user ? 'Explora una pregunta y elige Sí o No. Aquí verás cada predicción.' : `Crea tu acceso local y empieza con ${PumaDomain.STARTING_POINTS.toLocaleString('es-CL')} puntos Puma.`}</p><button class="text-button" id="dashboardStart">${user ? 'Explorar mercados →' : 'Comenzar →'}</button></div>`;
  $('#dashboardStart')?.addEventListener('click', () => user ? $('#mercados').scrollIntoView({ behavior:'smooth' }) : signInButton.click());
  renderWallet();
  renderConversion();
  $('#createdMarkets').innerHTML = user && ownMarkets().length ? [...ownMarkets()].reverse().map(item => `<a class="created-item" href="#mercado/${escapeHTML(item.id)}" data-created="${escapeHTML(item.id)}"><span>${escapeHTML(item.category)} · ${dateLabel(`${item.deadline}T12:00:00`)}</span><b>${escapeHTML(item.question)}</b><small>${outcomeLabel(item) ?? (isClosed(item) ? 'Cerrado · pendiente de resolver' : 'Abierto para predicciones')} ↗</small></a>`).join('') : '<div class="created-empty"><p>Las buenas preguntas empiezan contigo.</p><small>Tus mercados aparecerán aquí cuando crees el primero.</small></div>';
}

function filterMarkets() {
  const term = $('#searchInput').value.trim().toLocaleLowerCase();
  $$('.category').forEach(item => { item.classList.toggle('active', item.dataset.category === activeCategory); item.setAttribute('aria-pressed', String(item.dataset.category === activeCategory)); });
  $$('.market-card').forEach(card => card.classList.toggle('is-hidden', (activeCategory !== 'Todos' && card.dataset.category !== activeCategory) || !card.textContent.toLocaleLowerCase().includes(term)));
  $('#marketEmpty').hidden = Boolean($('.market-card:not(.is-hidden)'));
}

function renderMarkets() {
  $$('.user-market').forEach(card => card.remove());
  markets.forEach(item => {
    const card = document.createElement('article');
    card.className = 'market-card user-market';
    card.dataset.category = item.category;
    card.dataset.id = item.id;
    const closed = isClosed(item);
    const series = PumaDomain.series(allPredictions().filter(entry => PumaDomain.matches(entry, item)));
    const probability = series.at(-1)?.value;
    const status = item.resolution ? `RESUELTO · ${item.resolution.outcome.toUpperCase()}` : closed ? 'CERRADO' : `CIERRA ${dateLabel(`${item.deadline}T12:00:00`)}`;
    const progress = probability === undefined ? '<p class="market-criteria">Sin predicciones todavía.</p>' : `<div class="market-progress"><div class="progress-track"><span style="width:${probability}%"></span></div><div><b>${probability}%</b><span> SÍ</span></div></div>`;
    card.classList.toggle('is-resolved', Boolean(item.resolution));
    card.innerHTML = `<div class="card-art art-community"><span>LA COMUNIDAD PREGUNTA</span><b>¿Y si…?</b><i>↗</i></div><div class="card-content"><div class="card-meta"><span class="badge cyan">${escapeHTML(item.category)}</span><span>${status}</span></div><h3>${escapeHTML(item.question)}</h3>${progress}<div class="card-footer"><span>Creado por ${escapeHTML(item.author)}</span><button class="predict-button" ${closed ? 'disabled' : ''}>${item.resolution ? 'Resuelto' : closed ? 'Cerrado' : 'Predecir →'}</button></div></div>`;
    $('#marketGrid').prepend(card);
  });
  // Cards are rebuilt, so keep an open detail view pointing at the live element.
  if (currentDetail) currentDetail = $$('.market-card').find(card => card.dataset.id === currentDetail.dataset.id) ?? currentDetail;
  filterMarkets();
  $$('.market-card').forEach((card, index) => {
    if (!card.dataset.id) card.dataset.id = `demo-${index}`;
    const heading = $('h3', card);
    if (!$('a', heading)) { const link = document.createElement('a'); link.href = `#mercado/${card.dataset.id}`; link.textContent = heading.textContent; heading.replaceChildren(link); }
  });
  $$('.topic').forEach(topic => {
    const category = $('b', topic).textContent === 'El mundo' ? 'Mundo' : $('b', topic).textContent;
    const count = $$('.market-card').filter(card => card.dataset.category === category).length;
    $('small', topic).textContent = `${count} ${count === 1 ? 'mercado' : 'mercados'}`;
  });
}

function tomorrow() {
  const date = new Date(); date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
$$('[data-create]').forEach(button => button.addEventListener('click', () => requireUser(() => {
  $('#createDeadline').min = tomorrow();
  $('#createError').textContent = '';
  toggleModal($('#createModal'), true);
})));
$('#createForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!user) return;
  const question = $('#createQuestion').value.trim();
  const criteria = $('#createCriteria').value.trim();
  const category = $('#createCategory').value;
  const deadline = $('#createDeadline').value;
  if (deadline > '2026-12-31') {
    $('#createError').textContent = 'La fecha de cierre no puede superar el 31 de diciembre de 2026.'; return;
  }
  if (question.length < 12 || criteria.length < 15 || !['Chile','Mundo','Tecnología','Deportes','Cultura'].includes(category) || deadline < tomorrow()) {
    $('#createError').textContent = 'Completa la pregunta, el criterio y una fecha de cierre a partir de mañana y hasta el 31 de diciembre de 2026.'; return;
  }
  if (markets.some(item => item.question.toLocaleLowerCase() === question.toLocaleLowerCase())) { $('#createError').textContent = 'Ya creaste un mercado con esta pregunta.'; return; }
  markets.push({ id:crypto.randomUUID(), question, criteria, category, deadline, author:user.name, ownerId:user.id });
  storage.set('puma-markets', markets);
  activeCategory = 'Todos'; $('#searchInput').value = '';
  renderMarkets(); renderDashboard();
  toggleModal($('#createModal'), false); $('#createForm').reset();
  location.hash = 'mercados';
  $('#mercados').scrollIntoView({ behavior:'smooth' });
  showToast('Mercado creado', 'Tu pregunta ya está disponible en este navegador.');
});
// Wallet: one 16-character address per local account.
const clp = value => Number(value).toLocaleString('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 });
function renderWallet() {
  $('#walletSignedOut').hidden = Boolean(account);
  $('#walletSignedIn').hidden = !account;
  if (!account) return;
  $('#walletAddress').textContent = PumaDomain.formatWallet(account.wallet);
  $('#walletBalance').textContent = `${points(balance)} · ≈ ${clp(PumaDomain.toCLP(balance, supplyNow()))} ref.`;
  $('#transferAmount').max = balance;
  const transfers = [...(account.transfers ?? [])].reverse();
  $('#transferHistory').innerHTML = transfers.length
    ? `<ul class="transfer-list">${transfers.map(item => `<li class="transfer-${item.type}"><span>${item.type === 'out' ? 'Enviaste a' : 'Recibiste de'} ${escapeHTML(item.name)}<small>${escapeHTML(PumaDomain.formatWallet(item.wallet))} · ${dateLabel(item.date)}</small></span><b>${item.type === 'out' ? '−' : '+'}${points(item.amount)}</b></li>`).join('')}</ul>`
    : '<p class="transfer-empty">Aún no hay movimientos.</p>';
}
$('#walletLogin').addEventListener('click', () => signInButton.click());
$('#copyWallet').addEventListener('click', async () => {
  if (!account) return;
  try { await navigator.clipboard.writeText(PumaDomain.formatWallet(account.wallet)); showToast('Dirección copiada', PumaDomain.formatWallet(account.wallet)); }
  catch { showToast('No se pudo copiar', 'Selecciona la dirección y cópiala a mano.'); }
});
$('#transferTo').addEventListener('input', () => {
  const raw = $('#transferTo').value.trim();
  const wallet = PumaDomain.normalizeWallet(raw);
  const target = wallet && storage.get('puma-accounts', []).find(item => item.wallet === wallet);
  $('#transferRecipient').classList.toggle('found', Boolean(target && target.id !== account?.id));
  $('#transferRecipient').textContent = !raw ? '' : !wallet ? 'Usa 16 caracteres entre 0-9 y A-F.' : !target ? 'No hay ninguna cuenta con esa dirección.' : target.id === account?.id ? 'Esta es tu propia dirección.' : `Destinatario: ${target.name}`;
});
$('#transferForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!account) return;
  const amount = Number($('#transferAmount').value);
  // Re-read so balances changed in other tabs are respected.
  const fresh = storage.get('puma-accounts', []);
  const result = PumaDomain.transfer(fresh, account.id, $('#transferTo').value, amount, { id:crypto.randomUUID() });
  $('#transferError').textContent = result.error;
  if (result.error) return;
  const target = fresh.find(item => item.wallet === PumaDomain.normalizeWallet($('#transferTo').value));
  if (!window.confirm(`¿Enviar ${points(amount)} a ${target.name} (${PumaDomain.formatWallet(target.wallet)})? Una transferencia no se puede deshacer.`)) return;
  accounts = result.accounts;
  storage.set('puma-accounts', accounts);
  account = accounts.find(item => item.id === user.id);
  balance = account.balance;
  $('#transferForm').reset();
  $('#transferRecipient').textContent = '';
  renderDashboard();
  if (currentDetail) renderDetail();
  showToast('Transferencia enviada', `${points(amount)} para ${target.name}.`);
});

// Conversion guide: a fixed CLP fund split across every point in circulation.
const clpRate = value => Number(value).toLocaleString('es-CL', { style:'currency', currency:'CLP', minimumFractionDigits:0, maximumFractionDigits:2 });
const supplyNow = () => PumaDomain.circulating(accounts);
const reasonLabel = { 'inicio':'Inicio del registro', 'nueva cuenta':'Nueva cuenta', 'mercado resuelto':'Mercado resuelto', 'ajuste':'Ajuste' };
let ratePoints = [];
let rateFocus = -1;
function rateHistory() {
  const log = storage.get('puma-supply', []);
  const series = log.map(entry => ({ ...entry, value:PumaDomain.clpPerPoint(entry.supply) }));
  return series.length ? series : [{ date:new Date().toISOString(), supply:supplyNow(), reason:'inicio', value:PumaDomain.clpPerPoint(supplyNow()) }];
}
function renderConversion() {
  const supply = supplyNow();
  const rate = PumaDomain.clpPerPoint(supply);
  $('#conversionRate').textContent = `${clpRate(rate)} CLP`;
  $('#conversionRateNote').textContent = `${clp(PumaDomain.REFERENCE_FUND_CLP)} de referencia ÷ ${points(supply)} en circulación.`;
  $$('[data-clp-fund]').forEach(node => node.textContent = clp(PumaDomain.REFERENCE_FUND_CLP));
  $$('[data-clp-start]').forEach(node => node.textContent = points(PumaDomain.STARTING_POINTS));
  const typed = Math.max(0, Math.floor(Number($('#conversionInput').value) || 0));
  $('#conversionResult').textContent = clp(PumaDomain.toCLP(typed, supply));
  ratePoints = rateHistory();
  const first = ratePoints[0].value, last = ratePoints.at(-1).value;
  const change = first ? Math.round((last / first - 1) * 100) : 0;
  $('#conversionChartNote').textContent = ratePoints.length > 1 ? ` · ${change <= 0 ? '' : '+'}${change}% desde el inicio del registro` : ' · aún no hay cambios registrados';
  $('#conversionTable').innerHTML = `<table><thead><tr><th>Fecha</th><th>Evento</th><th>En circulación</th><th>1 P en CLP</th></tr></thead><tbody>${[...ratePoints].reverse().map(entry => `<tr><td>${escapeHTML(new Date(entry.date).toLocaleString('es-CL'))}</td><td>${escapeHTML(reasonLabel[entry.reason] ?? entry.reason)}</td><td>${points(entry.supply)}</td><td>${clpRate(entry.value)}</td></tr>`).join('')}</tbody></table>`;
  drawRateChart();
}
function niceCeiling(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map(step => step * power).find(candidate => candidate >= value);
}
// A change-over-time line does not need a zero baseline: fit the data so drops stay visible.
function rateDomain(values) {
  const low = Math.min(...values), high = Math.max(...values);
  const pad = (high - low) * 0.25 || high * 0.1 || 1;
  const step = niceCeiling((high - low + 2 * pad) / 4);
  const min = Math.max(0, Math.floor((low - pad) / step) * step);
  const max = Math.max(min + step * 4, Math.ceil((high + pad) / step) * step);
  return { min, max, step };
}
const rateTimeLabel = (time, span, compact = false) => new Date(time).toLocaleString('es-CL', span < 2 * 86400000
  ? (compact ? { hour:'2-digit', minute:'2-digit' } : { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
  : (compact ? { day:'numeric', month:'short' } : { day:'numeric', month:'short', year:'numeric' }));
function drawRateChart() {
  const svg = $('#conversionChart');
  const width = Math.max(280, Math.round(svg.parentElement.clientWidth || 480));
  const height = 220, left = 62, right = 16, top = 16, bottom = 30;
  const now = Date.now();
  const times = ratePoints.map(entry => new Date(entry.date).getTime());
  const start = times[0], end = Math.max(now, times.at(-1));
  const span = Math.max(end - start, 1);
  const domain = rateDomain(ratePoints.map(entry => entry.value));
  const x = time => left + (width - left - right) * (time - start) / span;
  const y = value => top + (height - top - bottom) * (1 - (value - domain.min) / (domain.max - domain.min));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  let markup = `<desc id="conversionChartDesc">Línea escalonada del valor de referencia de 1 punto Puma en pesos chilenos. Empieza en ${clpRate(ratePoints[0].value)} y hoy vale ${clpRate(ratePoints.at(-1).value)}. Usa las flechas para recorrer los cambios o abre la tabla.</desc>`;
  for (let value = domain.min; value <= domain.max + domain.step / 2; value += domain.step) {
    markup += `<line class="rate-grid" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text class="rate-axis" x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${escapeHTML(clpRate(value))}</text>`;
  }
  // Step-after path: the rate holds until the next change in circulation.
  let path = `M${x(times[0])},${y(ratePoints[0].value)}`;
  ratePoints.forEach((entry, index) => {
    if (index) path += ` H${x(times[index])} V${y(entry.value)}`;
  });
  path += ` H${x(end)}`;
  markup += `<path class="rate-line" d="${path}"/>`;
  ratePoints.forEach((entry, index) => { markup += `<circle class="rate-point" cx="${x(times[index])}" cy="${y(entry.value)}" r="4"/>`; });
  const lastValue = ratePoints.at(-1).value;
  markup += `<text class="rate-end" x="${x(end)}" y="${y(lastValue) - 10}" text-anchor="end">Hoy ${escapeHTML(clpRate(lastValue))}</text>`;
  markup += `<text class="rate-axis" x="${left}" y="${height - 8}">${escapeHTML(rateTimeLabel(start, span, width < 420))}</text><text class="rate-axis" x="${width - right}" y="${height - 8}" text-anchor="end">${escapeHTML(rateTimeLabel(end, span, width < 420))}</text>`;
  markup += `<line class="rate-cross" id="rateCross" x1="0" x2="0" y1="${top}" y2="${height - bottom}" visibility="hidden"/><rect class="rate-hit" x="${left}" y="${top}" width="${width - left - right}" height="${height - top - bottom}"/>`;
  svg.innerHTML = markup;
  svg.dataset.geometry = JSON.stringify({ left, right, width, start, span });
  if (rateFocus >= ratePoints.length) rateFocus = ratePoints.length - 1;
}
function showRate(index, px) {
  const entry = ratePoints[index];
  if (!entry) return;
  const cross = $('#rateCross');
  cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
  const tooltip = $('#conversionTooltip');
  tooltip.textContent = `${rateTimeLabel(new Date(entry.date).getTime(), 0)} · ${reasonLabel[entry.reason] ?? entry.reason} · 1 P ≈ ${clpRate(entry.value)} · ${points(entry.supply)} en circulación`;
  tooltip.hidden = false;
}
function hideRate() {
  $('#rateCross')?.setAttribute('visibility', 'hidden');
  $('#conversionTooltip').hidden = true;
}
$('#conversionChart').addEventListener('pointermove', event => {
  const svg = $('#conversionChart');
  const { left, right, width, start, span } = JSON.parse(svg.dataset.geometry || '{}');
  const rect = svg.getBoundingClientRect();
  const px = Math.min(width - right, Math.max(left, (event.clientX - rect.left) / rect.width * width));
  const time = start + span * (px - left) / (width - left - right);
  // Step chart: the value in force is the last change at or before the pointer.
  let index = 0;
  ratePoints.forEach((entry, i) => { if (new Date(entry.date).getTime() <= time) index = i; });
  showRate(index, px);
});
$('#conversionChart').addEventListener('pointerleave', hideRate);
$('#conversionChart').addEventListener('blur', hideRate);
$('#conversionChart').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const lastIndex = ratePoints.length - 1;
  rateFocus = event.key === 'Home' ? 0 : event.key === 'End' ? lastIndex : Math.min(lastIndex, Math.max(0, (rateFocus < 0 ? lastIndex : rateFocus) + (event.key === 'ArrowRight' ? 1 : -1)));
  const { left, right, width, start, span } = JSON.parse($('#conversionChart').dataset.geometry || '{}');
  showRate(rateFocus, left + (width - left - right) * (new Date(ratePoints[rateFocus].date).getTime() - start) / span);
});
$('#conversionInput').addEventListener('input', renderConversion);
if (window.ResizeObserver) new ResizeObserver(() => drawRateChart()).observe($('.conversion-chart-wrap'));

function logout() {
  user = null; account = null; balance = PumaDomain.STARTING_POINTS; pendingAction = null; storage.set('puma-user', null);
  $$('.modal-backdrop.open').forEach(modal => toggleModal(modal, false));
  authMode = 'login'; setSignedInUI();
  if (currentDetail) renderDetail();
  showToast('Sesión cerrada', 'Tu actividad sigue guardada en este navegador.');
}
$('#logoutButton').addEventListener('click', logout);
$('#accountLogout').addEventListener('click', logout);
$('#accountPhoneForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!account) return;
  accounts = storage.get('puma-accounts', []);
  const error = PumaDomain.phoneError($('#accountPhone').value, accounts, account.id);
  $('#accountError').textContent = error;
  if (error) return;
  account.phone = PumaDomain.normalizePhone($('#accountPhone').value); saveAccount();
  $('#accountPhone').value = account.phone; showToast('Teléfono guardado', 'Tu perfil local está actualizado.');
});
$('#viewAll').addEventListener('click', () => { activeCategory = 'Todos'; $('#searchInput').value = ''; filterMarkets(); });
$('#createdMarkets').addEventListener('click', event => {
  const link = event.target.closest('[data-created]');
  if (!link) return;
  event.preventDefault(); location.hash = `mercado/${link.dataset.created}`;
});

// Detail view and preferences are initialized below.
let currentDetail = null;
let chartPeriod = 'TODO';
let chartPoints = [];
let chartCoords = [];

function detailData(card) {
  const saved = markets.find(item => item.id === card.dataset.id);
  return saved ?? {
    id:card.dataset.id, question:$('h3',card).textContent, category:card.dataset.category,
    deadline:{'demo-0':'2026-12-02','demo-1':'2026-12-26','demo-2':'2026-11-20'}[card.dataset.id],
    criteria:'Mercado de demostración. Esta pregunta y su historial son ilustrativos; no existe una fuente oficial de resolución conectada. Las predicciones usan únicamente puntos virtuales.', demo:true
  };
}
function allPredictions() { return accounts.flatMap(entry => entry.predictions ?? []); }
function marketSeries(card) {
  const item = detailData(card);
  const predictions = allPredictions().filter(entry => PumaDomain.matches(entry, item));
  const target = Number(card.dataset.seed) || 50;
  const seedValues = [target-18,target-12,target-15,target-4,target-8,target+2,target-3,target+5,target-4,target-1,target-6,target+1,target-2,target];
  const seed = item.demo ? seedValues.map((value,index) => ({date:`2026-11-${String(index+1).padStart(2,'0')}T12:00:00`,value:Math.max(1,Math.min(99,value))})) : [];
  return { item, predictions, all:PumaDomain.series(predictions,seed) };
}
function resolveMarket(outcome) {
  const item = currentDetail && markets.find(entry => entry.id === currentDetail.dataset.id);
  if (!PumaDomain.canResolve(item, user?.id)) return;
  if (!window.confirm(`¿Confirmas que la respuesta correcta es "${outcome}"? Se repartirán los puntos y no se puede deshacer.`)) return;
  // Re-read so predictions made in other tabs are settled too.
  accounts = PumaDomain.settle(storage.get('puma-accounts', []), item, outcome);
  storage.set('puma-accounts', accounts);
  recordSupply('mercado resuelto');
  item.resolution = { outcome, resolvedAt:new Date().toISOString() };
  storage.set('puma-markets', markets);
  account = accounts.find(entry => entry.id === user.id) ?? null;
  balance = account?.balance ?? balance;
  const mine = myPredictions().filter(entry => PumaDomain.matches(entry, item));
  const won = mine.reduce((sum, entry) => sum + (entry.payout ?? 0), 0);
  renderMarkets(); renderDashboard(); renderPulse();
  currentDetail = $$('.market-card').find(card => card.dataset.id === item.id);
  renderDetail();
  showToast(`Mercado resuelto: ${outcome}`, mine.length ? `Recibiste ${points(won)} por tus predicciones.` : 'Los puntos se repartieron entre quienes acertaron.');
}
function renderPulse() {
  const { staked, predictions } = PumaDomain.activity(accounts);
  $('#pulseStaked').textContent = points(staked);
  $('#pulsePredictions').textContent = predictions.toLocaleString('es-CL');
  const items = $$('.market-card').map(card => {
    const { item, all } = marketSeries(card);
    const label = item.question.replace(/^¿|\?$/g, '');
    const short = label.length > 34 ? `${label.slice(0, 32).trim()}…` : label;
    const last = all.at(-1)?.value, previous = all.at(-2)?.value;
    const value = item.resolution ? `<b>${escapeHTML(item.resolution.outcome.toUpperCase())}</b>` : last === undefined ? '<b>SIN DATOS</b>' : `<b class="${previous !== undefined && last < previous ? 'down' : 'up'}">${last}% SÍ</b>`;
    return `<a href="#mercado/${escapeHTML(item.id)}">${escapeHTML(short.toLocaleUpperCase('es-CL'))} ${value}</a><i></i>`;
  }).join('');
  $('#tickerTrack').innerHTML = items;
}
function renderDetail() {
  if (!currentDetail) return;
  const item = detailData(currentDetail);
  $('#detailTitle').textContent = item.question;
  $('#detailOrderQuestion').textContent = item.question;
  $('#detailCategory').textContent = `${item.category} / ${item.demo ? 'MERCADO DE EJEMPLO' : 'COMUNIDAD PUMA'}`;
  $('#detailDeadline').textContent = `Cierre · ${dateLabel(`${item.deadline}T12:00:00`)}`;
  const closed = isClosed(item);
  $('#detailStatus').textContent = outcomeLabel(item) ?? (closed ? 'Cerrado' : 'Abierto');
  $('#detailYes').disabled = $('#detailNo').disabled = closed;
  $('#resolvePanel').hidden = !PumaDomain.canResolve(item, user?.id);
  $('#detailCriteria').textContent = item.criteria;
  $('#detailBalance').textContent = user ? formatBalance() : 'Inicia sesión';
  const { predictions, all } = marketSeries(currentDetail);
  $('#detailProbability').textContent = all.length ? `${all[all.length-1].value}%` : '—';
  $('#detailVolume').textContent = `${points(predictions.reduce((sum,entry) => sum+entry.stake,0))} en juego · ${predictions.length} ${predictions.length === 1 ? 'predicción local' : 'predicciones locales'}`;
  $('#chartSource').textContent = item.demo ? 'DEMO + ACTIVIDAD LOCAL' : 'ACTIVIDAD LOCAL';
  $('#chartNote').textContent = `${item.demo ? 'El historial inicial es ilustrativo. Los puntos posteriores reflejan las predicciones de este navegador. ' : ''}El porcentaje representa la proporción acumulada de puntos a Sí. Los periodos se cuentan desde el último dato. No es una cotización en tiempo real.`;
  chartPoints = PumaDomain.period(all,chartPeriod);
  drawChart();
}
function drawChart() {
  const left=18, right=740, top=20, bottom=260;
  let svg = '<title id="chartTitle">Evolución de la probabilidad de Sí</title><desc id="chartDescription">Porcentaje de puntos a Sí a lo largo del tiempo. Consulta los valores en Ver datos del gráfico.</desc>';
  for (let value=0;value<=100;value+=20) {
    const y = bottom - (bottom-top)*value/100;
    svg += `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" class="chart-grid"/><text x="755" y="${y+4}" class="chart-label">${value}%</text>`;
  }
  const first = chartPoints.length ? new Date(chartPoints[0].date).getTime() : 0;
  const last = chartPoints.length ? new Date(chartPoints[chartPoints.length-1].date).getTime() : 0;
  chartCoords = chartPoints.map((point,index) => ({x:last===first ? (left+right)/2 : left+(right-left)*(new Date(point.date).getTime()-first)/(last-first),y:bottom-(bottom-top)*point.value/100,index}));
  if (chartCoords.length) {
    const path = chartCoords.map((p,index)=>`${index ? 'L':'M'}${p.x},${p.y}`).join(' ');
    svg += `<defs><linearGradient id="chartFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#378eff" stop-opacity=".18"/><stop offset="100%" stop-color="#378eff" stop-opacity="0"/></linearGradient></defs>`;
    if (chartCoords.length>1) svg += `<path d="${path} L${chartCoords.at(-1).x},${bottom} L${chartCoords[0].x},${bottom} Z" fill="url(#chartFade)"/>`;
    svg += `<path d="${path}" class="chart-line"/>`;
    chartCoords.forEach(p => { svg += `<circle cx="${p.x}" cy="${p.y}" r="${p.index===chartCoords.length-1 ? 5 : 3}" class="chart-point"><title>${escapeHTML(dateLabel(chartPoints[p.index].date))} · ${chartPoints[p.index].value}% Sí</title></circle>`; });
    [0,Math.floor((chartPoints.length-1)/2),chartPoints.length-1].filter((n,i,a)=>a.indexOf(n)===i).forEach(index => { svg += `<text x="${chartCoords[index].x}" y="290" text-anchor="${index===0 ? 'start' : index===chartPoints.length-1 ? 'end' : 'middle'}" class="chart-label">${escapeHTML(dateLabel(chartPoints[index].date))}</text>`; });
  }
  $('#marketChart').innerHTML = svg;
  $('#chartEmpty').hidden = chartPoints.length > 0;
  $('#chartTooltip').hidden = true;
  $('#chartTable').innerHTML = chartPoints.length ? `<table><thead><tr><th>Fecha</th><th>Probabilidad de Sí</th></tr></thead><tbody>${chartPoints.map(point=>`<tr><td>${escapeHTML(new Date(point.date).toLocaleString('es-CL'))}</td><td>${point.value}%</td></tr>`).join('')}</tbody></table>` : '<p>No hay datos en este periodo.</p>';
  $$('[data-period]').forEach(button=> { const active=button.dataset.period===chartPeriod; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
}
function route() {
  const prefix = '#mercado/';
  const id = location.hash.startsWith(prefix) ? location.hash.slice(prefix.length) : null;
  currentDetail = id ? $$('.market-card').find(card=>card.dataset.id===id) : null;
  document.body.classList.toggle('market-view',Boolean(currentDetail));
  $('#marketDetail').hidden = !currentDetail;
  if (currentDetail) { chartPeriod='TODO'; renderDetail(); $('#marketDetail').focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'}); }
  else if (id) { showToast('Mercado no disponible','Esta pregunta no está guardada en este navegador.'); }
  else if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({behavior:'smooth'});
}
window.addEventListener('hashchange',route);
$('#detailYes').addEventListener('click',()=>openPrediction(currentDetail,'Sí'));
$('#detailNo').addEventListener('click',()=>openPrediction(currentDetail,'No'));
$$('[data-period]').forEach(button=>button.addEventListener('click',()=>{chartPeriod=button.dataset.period;renderDetail();}));
$('#marketChart').addEventListener('pointermove',event=>{
  if (!chartCoords.length) return;
  const rect=$('#marketChart').getBoundingClientRect();
  const x=(event.clientX-rect.left)/rect.width*800;
  const nearest=chartCoords.reduce((best,point)=>Math.abs(point.x-x)<Math.abs(best.x-x)?point:best);
  const point=chartPoints[nearest.index];
  $('#chartTooltip').textContent=`${dateLabel(point.date)} · ${point.value}% Sí`;
  $('#chartTooltip').hidden=false;
});
$('#marketChart').addEventListener('pointerleave',()=>$('#chartTooltip').hidden=true);
function applyTheme(theme) {
  document.documentElement.dataset.theme=theme;
  $('#themeToggle').textContent=theme==='dark' ? '☀ Modo claro' : '☾ Modo oscuro';
  $('#themeToggle').setAttribute('aria-pressed',String(theme==='dark'));
  $('meta[name="theme-color"]').content=theme==='dark' ? '#0c1217' : '#f7f5ef';
}
$('#themeToggle').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';storage.set('puma-theme',theme);applyTheme(theme);});
applyTheme(storage.get('puma-theme','light'));
$$('.market-card').forEach((card,index)=>{ card.dataset.id=`demo-${index}`; card.dataset.seed=$('.market-progress b',card)?.textContent.replace('%','') ?? ''; });
$('#resolveYes').addEventListener('click',()=>resolveMarket('Sí'));
$('#resolveNo').addEventListener('click',()=>resolveMarket('No'));
renderMarkets();
setSignedInUI();
renderPulse();
route();
