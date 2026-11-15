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
  }
};
if (typeof module !== 'undefined') module.exports = PumaDomain;
