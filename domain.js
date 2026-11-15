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
  activity(accounts) {
    const open = accounts.flatMap(account => (account.predictions ?? []).filter(item => !item.result));
    return { staked:open.reduce((sum, item) => sum + item.stake, 0), predictions:open.length };
  }
};
if (typeof module !== 'undefined') module.exports = PumaDomain;
