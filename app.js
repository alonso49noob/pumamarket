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
  accounts = [{ ...account, id:crypto.randomUUID(), balance:storage.get('puma-balance', 1000), predictions:storage.get('puma-predictions', []) }];
  storage.set('puma-accounts', accounts);
}
account = user ? accounts.find(item => item.id === user.id || (!user.id && item.name === user.name)) : null;
user = account ? { id:account.id, name:account.name } : null;
storage.set('puma-user', user);
let authMode = accounts.length ? 'login' : 'register';
let selectedMarketId = '';
let selectedMarket = '';
let selectedChoice = 'Sí';
let balance = account?.balance ?? 1000;
let markets = storage.get('puma-markets', []);
let pendingAction = null;
let activeCategory = 'Todos';
let modalTrigger = null;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const points = value => `${Number(value).toLocaleString('es-CL')} P`;
const dateLabel = value => new Date(value).toLocaleDateString('es-CL', { day:'numeric', month:'short', year:'numeric' });
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
    : 'Crea una sesión para guardar tus predicciones y recibir <b>1.000 puntos Puma</b>. Son virtuales: no tienen valor monetario.';
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
      matched = { id:crypto.randomUUID(), name, phone:PumaDomain.normalizePhone(phoneValue), passwordHash:hash, balance:1000, predictions:[] };
      accounts.push(matched);
      storage.set('puma-accounts', accounts);
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
    if (market && new Date(`${market.deadline}T23:59:59`) <= new Date()) { showToast('Mercado cerrado', 'La fecha de cierre de esta pregunta ya pasó.'); return; }
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
  if (market && new Date(`${market.deadline}T23:59:59`) <= new Date()) { toggleModal(predictionModal, false); showToast('Mercado cerrado', 'Esta pregunta ya no admite predicciones.'); return; }
  if (stake > balance) { showToast('Puntos insuficientes', 'Elige una cantidad menor para tu predicción.'); return; }
  balance -= stake;
  account.balance = balance;
  account.predictions.push({ marketId:selectedMarketId, market: selectedMarket, choice: selectedChoice, stake, date: new Date().toISOString() });
  saveAccount();
  renderDashboard();
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

function renderDashboard() {
  const predictions = user ? myPredictions() : [];
  $('#dashboardTitle').textContent = user ? `Hola, ${user.name}. Esta es tu mirada.` : 'Tu próxima idea cuenta.';
  $('#dashboardSubtitle').textContent = user ? 'Tus puntos, tus preguntas y cada decisión, en un solo lugar.' : 'Inicia sesión para guardar tus predicciones y seguir tu actividad.';
  $('#logoutButton').hidden = !user;
  $('#statBalance').textContent = user ? points(balance) : '—';
  $('#statStaked').textContent = user ? points(predictions.reduce((sum, item) => sum + item.stake, 0)) : '—';
  $('#statPredictions').textContent = user ? predictions.length : '—';
  $('#statCreated').textContent = user ? ownMarkets().length : '—';
  $('#predictionHistory').innerHTML = predictions.length ? `<div class="history-scroll"><table><thead><tr><th>Mercado</th><th>Tu lectura</th><th>Puntos</th><th>Fecha</th></tr></thead><tbody>${[...predictions].reverse().map(item => `<tr><td>${escapeHTML(item.market)}<small>Registrada · sin resultado aún</small></td><td><span class="choice-pill ${item.choice === 'No' ? 'negative' : ''}">${escapeHTML(item.choice)}</span></td><td>${points(item.stake)}</td><td>${dateLabel(item.date)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><span class="empty-icon">↗</span><h4>${user ? 'Tu primera lectura está por llegar.' : 'Una mirada propia empieza aquí.'}</h4><p>${user ? 'Explora una pregunta y elige Sí o No. Aquí verás cada predicción.' : 'Crea tu acceso local y empieza con 1.000 puntos Puma.'}</p><button class="text-button" id="dashboardStart">${user ? 'Explorar mercados →' : 'Comenzar →'}</button></div>`;
  $('#dashboardStart')?.addEventListener('click', () => user ? $('#mercados').scrollIntoView({ behavior:'smooth' }) : signInButton.click());
  $('#createdMarkets').innerHTML = user && ownMarkets().length ? [...ownMarkets()].reverse().map(item => `<a class="created-item" href="#mercado/${escapeHTML(item.id)}" data-created="${escapeHTML(item.id)}"><span>${escapeHTML(item.category)} · ${dateLabel(`${item.deadline}T12:00:00`)}</span><b>${escapeHTML(item.question)}</b><small>${new Date(`${item.deadline}T23:59:59`) > new Date() ? 'Abierto para predicciones' : 'Cerrado'} ↗</small></a>`).join('') : '<div class="created-empty"><p>Las buenas preguntas empiezan contigo.</p><small>Tus mercados aparecerán aquí cuando crees el primero.</small></div>';
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
function logout() {
  user = null; account = null; balance = 1000; pendingAction = null; storage.set('puma-user', null);
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
function renderDetail() {
  if (!currentDetail) return;
  const item = detailData(currentDetail);
  $('#detailTitle').textContent = item.question;
  $('#detailOrderQuestion').textContent = item.question;
  $('#detailCategory').textContent = `${item.category} / ${item.demo ? 'MERCADO DE EJEMPLO' : 'COMUNIDAD PUMA'}`;
  $('#detailDeadline').textContent = `Cierre · ${dateLabel(`${item.deadline}T12:00:00`)}`;
  const closed = new Date(`${item.deadline}T23:59:59`) <= new Date();
  $('#detailStatus').textContent = closed ? 'Cerrado' : 'Abierto';
  $('#detailYes').disabled = $('#detailNo').disabled = closed;
  $('#detailCriteria').textContent = item.criteria;
  $('#detailBalance').textContent = user ? formatBalance() : 'Inicia sesión';
  const predictions = accounts.flatMap(entry => entry.predictions ?? []).filter(entry => entry.marketId ? entry.marketId === item.id : entry.market === item.question);
  const target = Number($('.market-progress b',currentDetail)?.textContent.replace('%','')) || 50;
  const seedValues = [target-18,target-12,target-15,target-4,target-8,target+2,target-3,target+5,target-4,target-1,target-6,target+1,target-2,target];
  const seed = item.demo ? seedValues.map((value,index) => ({date:`2026-11-${String(index+1).padStart(2,'0')}T12:00:00`,value:Math.max(1,Math.min(99,value))})) : [];
  const all = PumaDomain.series(predictions,seed);
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
$$('.market-card').forEach((card,index)=>card.dataset.id=`demo-${index}`);
renderMarkets();
setSignedInUI();
route();
