/* Shared rules for the browser and the dependency-free Node checks. */
const PumaDomain = {
  normalizePhone(value) {
    const compact = String(value).trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
    return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
  },
  phoneError(value, accounts, exceptId = null) {
    const phone = this.normalizePhone(value);
    if (!phone) return 'Ingresa un teléfono válido con código de país, por ejemplo +56 9 1234 5678.';
    return accounts.some(item => item.id !== exceptId && this.normalizePhone(item.phone ?? '') === phone)
      ? 'Este número de teléfono ya está asociado a otra cuenta.' : '';
  },
  series(predictions, seed = []) {
    let yes = 0, total = 0;
    const actual = [...predictions].sort((a,b) => new Date(a.date) - new Date(b.date)).map(item => {
      total += item.stake; if (item.choice === 'Sí') yes += item.stake;
      return { date:item.date, value:Math.round(100 * yes / total) };
    });
    return [...seed, ...actual].sort((a,b) => new Date(a.date) - new Date(b.date));
  },
  period(series, period) {
    if (!series.length || period === 'TODO') return series;
    const days = { '1D':1, '1S':7, '1M':30 }[period];
    const cutoff = new Date(series[series.length - 1].date).getTime() - days * 86400000;
    return series.filter(item => new Date(item.date).getTime() >= cutoff);
  },
  matches(prediction, market) {
    return prediction.marketId ? prediction.marketId === market.id : prediction.market === market.question;
  },
  pool(predictions) {
    return predictions.reduce((pool, item) => {
      pool.total += item.stake;
      pool[item.choice === 'Sí' ? 'yes' : 'no'] += item.stake;
      return pool;
    }, { yes:0, no:0, total:0 });
  },
  canResolve(market, userId) {
    return Boolean(market && userId && !market.demo && !market.resolution && market.ownerId === userId);
  },
  /**
   * Points credited back to one prediction when its market resolves.
   * `pool` sums every unresolved stake on the market: { yes, no, total }.
   * Must return a whole number >= 0; losing predictions always get 0.
   */
  payout(prediction, outcome, pool) {
    if (prediction.choice !== outcome) return 0;
    // Shared pool: winners split every stake in proportion to what they put in.
    const winningSide = outcome === 'Sí' ? pool.yes : pool.no;
    if (winningSide <= 0) return prediction.stake;
    return Math.floor(prediction.stake * pool.total / winningSide);
  },
  settle(accounts, market, outcome, resolvedAt = new Date().toISOString()) {
    const open = accounts.flatMap(account => (account.predictions ?? []).filter(item => this.matches(item, market) && !item.result));
    const pool = this.pool(open);
    return accounts.map(account => {
      let credit = 0;
      const predictions = (account.predictions ?? []).map(item => {
        if (!this.matches(item, market) || item.result) return item;
        const paid = Math.max(0, Math.floor(this.payout(item, outcome, pool)));
        credit += paid;
        return { ...item, result:item.choice === outcome ? 'won' : 'lost', payout:paid, resolvedAt };
      });
      return { ...account, balance:(account.balance ?? 0) + credit, predictions };
    });
  },
  // Points every new account receives once, at registration.
  STARTING_POINTS: 100,
  // Reference value only: points are never bought or redeemed for money.
  // The whole economy is pegged to one fixed CLP amount, so every new
  // account dilutes what each point is worth.
  REFERENCE_FUND_CLP: 100000,
  circulating(accounts) {
    return accounts.reduce((sum, account) => sum + (account.balance ?? 0)
      + (account.predictions ?? []).filter(item => !item.result).reduce((staked, item) => staked + item.stake, 0), 0);
  },
  clpPerPoint(supply) {
    return this.REFERENCE_FUND_CLP / Math.max(supply, this.STARTING_POINTS);
  },
  toCLP(amount, supply) {
    return Math.round(Number(amount) * this.clpPerPoint(supply));
  },
  logSupply(log, supply, date = new Date().toISOString(), reason = '') {
    return log.at(-1)?.supply === supply ? log : [...log, { date, supply, reason }];
  },
  normalizeWallet(value) {
    const compact = String(value ?? '').toUpperCase().replace(/[\s-]/g, '');
    return /^[0-9A-F]{16}$/.test(compact) ? compact : null;
  },
  formatWallet(wallet) {
    return wallet ? wallet.match(/.{4}/g).join('-') : '';
  },
  newWallet(accounts, randomBytes) {
    const taken = new Set(accounts.map(item => item.wallet));
    for (let attempt = 0; attempt < 20; attempt++) {
      const wallet = [...randomBytes(8)].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
      if (!taken.has(wallet)) return wallet;
    }
    throw new Error('No se pudo generar una dirección de billetera única.');
  },
  assignWallets(accounts, randomBytes) {
    const result = [];
    for (const item of accounts) {
      result.push(this.normalizeWallet(item.wallet) ? item : { ...item, wallet:this.newWallet([...result, ...accounts], randomBytes) });
    }
    return result;
  },
  // Phone verification: the admin signs a phone number offline (ECDSA P-256)
  // and the site checks that signature with the published public key.
  VERIFY_PREFIX: 'pumamarket-verificacion:v1:',
  VERIFY_ALGORITHM: { name:'ECDSA', namedCurve:'P-256' },
  base64url(bytes) {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  fromBase64url(text) {
    if (!/^[A-Za-z0-9_-]+$/.test(text ?? '')) return null;
    try {
      const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
      return Uint8Array.from(raw, char => char.charCodeAt(0));
    } catch { return null; }
  },
  verificationLink(site, phone, signature) {
    return `${site}#verificar/${this.normalizePhone(phone).slice(1)}/${signature}`;
  },
  parseVerification(hash) {
    const match = /^#verificar\/(\d{8,15})\/([A-Za-z0-9_-]{40,200})$/.exec(hash ?? '');
    return match ? { phone:`+${match[1]}`, signature:match[2] } : null;
  },
  async signPhone(phone, privateJwk, subtle) {
    const normalized = this.normalizePhone(phone);
    if (!normalized) throw new Error('Número de teléfono no válido.');
    const key = await subtle.importKey('jwk', privateJwk, this.VERIFY_ALGORITHM, false, ['sign']);
    const signature = await subtle.sign({ name:'ECDSA', hash:'SHA-256' }, key, new TextEncoder().encode(this.VERIFY_PREFIX + normalized));
    return this.base64url(new Uint8Array(signature));
  },
  async verifyPhone(phone, signature, publicJwk, subtle) {
    const normalized = this.normalizePhone(phone);
    const bytes = this.fromBase64url(signature);
    if (!normalized || !bytes || !publicJwk || !subtle) return false;
    try {
      const key = await subtle.importKey('jwk', publicJwk, this.VERIFY_ALGORITHM, false, ['verify']);
      return await subtle.verify({ name:'ECDSA', hash:'SHA-256' }, key, bytes, new TextEncoder().encode(this.VERIFY_PREFIX + normalized));
    } catch { return false; }
  },
  transfer(accounts, fromId, toWallet, amount, { id = '', date = new Date().toISOString() } = {}) {
    const sender = accounts.find(item => item.id === fromId);
    const wallet = this.normalizeWallet(toWallet);
    const receiver = wallet && accounts.find(item => item.wallet === wallet);
    let error = '';
    if (!sender) error = 'Inicia sesión para transferir puntos.';
    else if (!sender.phoneVerified) error = 'Verifica tu teléfono antes de transferir puntos.';
    else if (!wallet) error = 'La dirección debe tener 16 caracteres (0-9 y A-F).';
    else if (!receiver) error = 'No hay ninguna cuenta con esa dirección en este navegador.';
    else if (receiver.id === sender.id) error = 'No puedes transferir puntos a tu propia cuenta.';
    else if (!Number.isInteger(amount) || amount < 1) error = 'Ingresa una cantidad entera de puntos, mínimo 1.';
    else if (amount > sender.balance) error = 'No tienes saldo suficiente para esa transferencia.';
    if (error) return { accounts, error };
    const record = { id, amount, date };
    return {
      error:'',
      accounts:accounts.map(item => {
        if (item.id === sender.id) return { ...item, balance:item.balance - amount, transfers:[...(item.transfers ?? []), { ...record, type:'out', wallet, name:receiver.name }] };
        if (item.id === receiver.id) return { ...item, balance:item.balance + amount, transfers:[...(item.transfers ?? []), { ...record, type:'in', wallet:sender.wallet, name:sender.name }] };
        return item;
      })
    };
  },
  activity(accounts) {
    const open = accounts.flatMap(account => (account.predictions ?? []).filter(item => !item.result));
    return { staked:open.reduce((sum, item) => sum + item.stake, 0), predictions:open.length };
  }
};
if (typeof module !== 'undefined') module.exports = PumaDomain;
