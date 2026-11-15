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
  modal.classList.toggle('open', shouldOpen);
  modal.setAttribute('aria-hidden', String(!shouldOpen));
  if (shouldOpen) setTimeout(() => $('input, button', modal)?.focus(), 100);
}

function formatBalance() { return `${balance.toLocaleString('es-CL')} P`; }

function setSignedInUI() {
  if (!user) return;
  signInButton.innerHTML = `<span class="user-dot">${user.name.slice(0, 1).toUpperCase()}</span> ${user.name}`;
  signInButton.classList.add('signed-in');
  signInButton.setAttribute('title', 'Sesión iniciada');
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
  if (user && account) { showToast(`Hola, ${user.name}`, `Tienes ${formatBalance()} para seguir explorando.`); return; }
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
  showToast('Solicitud enviada', 'La solicitud fue registrada para revisión.');
});

$$('[data-close]').forEach(button => button.addEventListener('click', () => toggleModal($(`#${button.dataset.close}`), false)));
$$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) toggleModal(backdrop, false); }));

$$('.predict-button').forEach(button => button.addEventListener('click', () => {
  selectedMarket = button.dataset.market;
  $('#marketQuestion').textContent = selectedMarket;
  if (!user) { toggleModal(authModal, true); return; }
  $('#balanceLabel').textContent = formatBalance();
  toggleModal(predictionModal, true);
}));

$$('.choice').forEach(button => button.addEventListener('click', () => {
  $$('.choice').forEach(item => item.classList.remove('active'));
  button.classList.add('active'); selectedChoice = button.dataset.choice;
}));

$('#stakeRange').addEventListener('input', event => $('#stakeValue').textContent = event.target.value);

$('#confirmPrediction').addEventListener('click', () => {
  const stake = Number($('#stakeRange').value);
  if (stake > balance) { showToast('Puntos insuficientes', 'Elige una cantidad menor para tu predicción.'); return; }
  balance -= stake;
  storage.set('puma-balance', balance);
  const predictions = storage.get('puma-predictions', []);
  predictions.push({ market: selectedMarket, choice: selectedChoice, stake, date: new Date().toISOString() });
  storage.set('puma-predictions', predictions);
  toggleModal(predictionModal, false);
  showToast('Predicción registrada', `${selectedChoice} · ${stake} puntos Puma en juego.`);
});

$$('.category').forEach(button => button.addEventListener('click', () => {
  $$('.category').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  $$('.market-card').forEach(card => card.classList.toggle('is-hidden', button.dataset.category !== 'Todos' && card.dataset.category !== button.dataset.category));
}));

$$('.topic').forEach(topic => topic.addEventListener('click', () => {
  const name = $('b', topic).textContent;
  showToast(name, 'Muy pronto podrás explorar todos los mercados de esta categoría.');
}));

$('#howItWorks').addEventListener('click', () => document.querySelector('.principles').scrollIntoView({ behavior: 'smooth' }));
const searchPanel = $('#searchPanel');
$('.search-toggle').addEventListener('click', () => { searchPanel.classList.toggle('open'); if (searchPanel.classList.contains('open')) $('#searchInput').focus(); });
$('#searchInput').addEventListener('input', event => {
  const term = event.target.value.toLowerCase();
  $$('.market-card').forEach(card => card.classList.toggle('is-hidden', !!term && !card.textContent.toLowerCase().includes(term)));
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $$('.modal-backdrop.open').forEach(modal => toggleModal(modal, false)); searchPanel.classList.remove('open'); } });

setSignedInUI();
