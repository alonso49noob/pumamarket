const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const $ = (selector, parent = document) => parent.querySelector(selector);

const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};

let user = storage.get('puma-user', null);
let account = storage.get('puma-account', null);
let selectedMarket = '';
let selectedChoice = 'Sí';
let balance = storage.get('puma-balance', 1000);
let markets = storage.get('puma-markets', []);
let pendingAction = null;
let activeCategory = 'Todos';
let modalTrigger = null;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const points = value => `${Number(value).toLocaleString('es-CL')} P`;
const dateLabel = value => new Date(value).toLocaleDateString('es-CL', { day:'numeric', month:'short', year:'numeric' });

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
  signInButton.setAttribute('title', user ? 'Abrir mi dashboard' : 'Iniciar sesión');
  renderDashboard();
}

function configureAuth() {
  const isReturning = Boolean(account);
  $('#authTitle').textContent = isReturning ? 'Qué bueno verte de nuevo.' : 'Tu próxima buena intuición empieza aquí.';
  $('#authNote').innerHTML = isReturning
    ? 'Ingresa tus datos para volver a tus mercados y puntos Puma.'
    : 'Crea una sesión para guardar tus predicciones y recibir <b>1.000 puntos Puma</b>. Son virtuales: no tienen valor monetario.';
  $('#authSubmit').innerHTML = `${isReturning ? 'Iniciar sesión' : 'Crear acceso'} <span>→</span>`;
  $('#userName').value = isReturning ? account.name : '';
  $('#userName').readOnly = isReturning;
  $('#userPassword').value = '';
  $('#userPassword').setAttribute('autocomplete', isReturning ? 'current-password' : 'new-password');
  $('#resetRequest').hidden = true;
  $('#authForm').hidden = false;
  $('#showReset').hidden = false;
}

function showToast(message = 'Predicción registrada', description = 'Tus puntos Puma se actualizaron.') {
  $('b', toast).textContent = message;
  $('small', toast).textContent = description;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

signInButton.addEventListener('click', () => {
  if (user && account) { $('#mi-cartera').scrollIntoView({ behavior:'smooth' }); return; }
  if (user && !account) { user = null; storage.set('puma-user', null); }
  configureAuth();
  toggleModal(authModal, true);
});

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const isReturning = Boolean(account);
  const name = $('#userName').value.trim();
  const hash = await passwordHash($('#userPassword').value);
  if (isReturning && account.passwordHash !== hash) {
    showToast('Contraseña incorrecta', 'Inténtalo de nuevo o envía una solicitud de recuperación.');
    $('#userPassword').focus();
    return;
  }
  if (!isReturning) {
    account = { name, passwordHash: hash };
    storage.set('puma-account', account);
  }
  user = { name: account.name };
  storage.set('puma-user', user);
  toggleModal(authModal, false);
  setSignedInUI();
  showToast(isReturning ? `Bienvenido de vuelta, ${user.name}` : `Bienvenido, ${user.name}`, isReturning ? 'Tu sesión está lista para continuar.' : 'Tu acceso está listo. Tus puntos Puma son virtuales.');
  const action = pendingAction;
  pendingAction = null;
  if (action) action();
});

$('#showReset').addEventListener('click', () => {
  $('#authForm').hidden = true;
  $('#showReset').hidden = true;
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

function openPrediction(card) {
  requireUser(() => {
    const market = markets.find(item => item.id === card.dataset.id);
    if (market && new Date(`${market.deadline}T23:59:59`) <= new Date()) { showToast('Mercado cerrado', 'La fecha de cierre de esta pregunta ya pasó.'); return; }
    selectedMarket = $('h3', card).textContent;
    $('#marketQuestion').textContent = selectedMarket;
    selectedChoice = 'Sí';
    $$('.choice').forEach(item => { item.classList.toggle('active', item.dataset.choice === 'Sí'); item.setAttribute('aria-pressed', String(item.dataset.choice === 'Sí')); });
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
  if (button) openPrediction(button.closest('.market-card'));
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
  const market = markets.find(item => item.question === selectedMarket);
  if (market && new Date(`${market.deadline}T23:59:59`) <= new Date()) { toggleModal(predictionModal, false); showToast('Mercado cerrado', 'Esta pregunta ya no admite predicciones.'); return; }
  if (stake > balance) { showToast('Puntos insuficientes', 'Elige una cantidad menor para tu predicción.'); return; }
  balance -= stake;
  storage.set('puma-balance', balance);
  const predictions = storage.get('puma-predictions', []);
  predictions.push({ market: selectedMarket, choice: selectedChoice, stake, date: new Date().toISOString() });
  storage.set('puma-predictions', predictions);
  renderDashboard();
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

function renderDashboard() {
  const predictions = user ? storage.get('puma-predictions', []) : [];
  $('#dashboardTitle').textContent = user ? `Hola, ${user.name}. Esta es tu mirada.` : 'Tu próxima idea cuenta.';
  $('#dashboardSubtitle').textContent = user ? 'Tus puntos, tus preguntas y cada decisión, en un solo lugar.' : 'Inicia sesión para guardar tus predicciones y seguir tu actividad.';
  $('#logoutButton').hidden = !user;
  $('#statBalance').textContent = user ? points(balance) : '—';
  $('#statStaked').textContent = user ? points(predictions.reduce((sum, item) => sum + item.stake, 0)) : '—';
  $('#statPredictions').textContent = user ? predictions.length : '—';
  $('#statCreated').textContent = user ? markets.length : '—';
  $('#predictionHistory').innerHTML = predictions.length ? `<div class="history-scroll"><table><thead><tr><th>Mercado</th><th>Tu lectura</th><th>Puntos</th><th>Fecha</th></tr></thead><tbody>${[...predictions].reverse().map(item => `<tr><td>${escapeHTML(item.market)}<small>Registrada · sin resultado aún</small></td><td><span class="choice-pill ${item.choice === 'No' ? 'negative' : ''}">${escapeHTML(item.choice)}</span></td><td>${points(item.stake)}</td><td>${dateLabel(item.date)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><span class="empty-icon">↗</span><h4>${user ? 'Tu primera lectura está por llegar.' : 'Una mirada propia empieza aquí.'}</h4><p>${user ? 'Explora una pregunta y elige Sí o No. Aquí verás cada predicción.' : 'Crea tu acceso local y empieza con 1.000 puntos Puma.'}</p><button class="text-button" id="dashboardStart">${user ? 'Explorar mercados →' : 'Comenzar →'}</button></div>`;
  $('#dashboardStart')?.addEventListener('click', () => user ? $('#mercados').scrollIntoView({ behavior:'smooth' }) : signInButton.click());
  $('#createdMarkets').innerHTML = user && markets.length ? [...markets].reverse().map(item => `<a class="created-item" href="#mercados" data-created="${escapeHTML(item.id)}"><span>${escapeHTML(item.category)} · ${dateLabel(`${item.deadline}T12:00:00`)}</span><b>${escapeHTML(item.question)}</b><small>${new Date(`${item.deadline}T23:59:59`) > new Date() ? 'Abierto para predicciones' : 'Cerrado'} ↗</small></a>`).join('') : '<div class="created-empty"><p>Las buenas preguntas empiezan contigo.</p><small>Tus mercados aparecerán aquí cuando crees el primero.</small></div>';
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
    const closed = new Date(`${item.deadline}T23:59:59`) <= new Date();
    card.innerHTML = `<div class="card-art art-community"><span>LA COMUNIDAD PREGUNTA</span><b>¿Y si…?</b><i>↗</i></div><div class="card-content"><div class="card-meta"><span class="badge cyan">${escapeHTML(item.category)}</span><span>${closed ? 'CERRADO' : `CIERRA ${dateLabel(`${item.deadline}T12:00:00`)}`}</span></div><h3>${escapeHTML(item.question)}</h3><p class="market-criteria">${escapeHTML(item.criteria)}</p><div class="card-footer"><span>Creado por ${escapeHTML(item.author)}</span><button class="predict-button" ${closed ? 'disabled' : ''}>${closed ? 'Cerrado' : 'Predecir →'}</button></div></div>`;
    $('#marketGrid').prepend(card);
  });
  filterMarkets();
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
  markets.push({ id:crypto.randomUUID(), question, criteria, category, deadline, author:user.name });
  storage.set('puma-markets', markets);
  activeCategory = 'Todos'; $('#searchInput').value = '';
  renderMarkets(); renderDashboard();
  toggleModal($('#createModal'), false); $('#createForm').reset();
  $('#mercados').scrollIntoView({ behavior:'smooth' });
  showToast('Mercado creado', 'Tu pregunta ya está disponible en este navegador.');
});
$('#logoutButton').addEventListener('click', () => {
  user = null; pendingAction = null; storage.set('puma-user', null); setSignedInUI();
  showToast('Sesión cerrada', 'Tu actividad sigue guardada en este navegador.');
});
$('#viewAll').addEventListener('click', () => { activeCategory = 'Todos'; $('#searchInput').value = ''; filterMarkets(); });
$('#createdMarkets').addEventListener('click', event => {
  const link = event.target.closest('[data-created]');
  if (!link) return;
  event.preventDefault(); activeCategory = 'Todos'; $('#searchInput').value = ''; filterMarkets();
  const card = $$('.user-market').find(item => item.dataset.id === link.dataset.created);
  card?.scrollIntoView({ behavior:'smooth', block:'center' });
});

renderMarkets();

setSignedInUI();
