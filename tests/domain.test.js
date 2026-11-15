const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../domain.js');

test('equivalent international phone formats normalize to one identifier', () => {
  for (const phone of ['+1 202 555 0100', '001 (202) 555-0100', '+12025550100']) {
    assert.equal(rules.normalizePhone(phone), '+12025550100');
  }
});
test('invalid phone numbers are rejected', () => {
  for (const phone of ['', '1234', '2025550100', '+01234567890', '+1hello2025550100', '+1234567890123456']) {
    assert.equal(rules.normalizePhone(phone), null);
  }
});
test('duplicate phone registration is blocked even with another format', () => {
  assert.match(rules.phoneError('001 (202) 555-0100', [{id:'one',phone:'+12025550100'}]), /ya está asociado/);
});
test('profile can keep its phone but cannot take another account phone', () => {
  const accounts = [{id:'one',phone:'+12025550100'},{id:'two',phone:'+12025550101'}];
  assert.equal(rules.phoneError('+1 202 555 0100', accounts,'one'), '');
  assert.ok(rules.phoneError('+1 202 555 0101',accounts,'one'));
});
test('chart sorts observations and weights points instead of counting votes', () => {
  const series = rules.series([
    {date:'2026-11-12T12:00:00Z',choice:'No',stake:300},
    {date:'2026-11-01T12:00:00Z',choice:'Sí',stake:100}
  ]);
  assert.deepEqual(series.map(point=>point.value),[100,25]);
  assert.equal(rules.period(series,'1S').length,1);
  assert.equal(rules.period(series,'1M').length,2);
  assert.equal(rules.period(series,'TODO').length,2);
});
test('new markets have no fabricated probability history', () => {
  assert.deepEqual(rules.series([]),[]);
  assert.deepEqual(rules.period([],'1D'),[]);
});

const market = { id:'m1', question:'¿Lloverá mañana?', ownerId:'ana' };
const accountsWithBets = () => [
  { id:'ana', balance:900, predictions:[{ marketId:'m1', choice:'Sí', stake:100, date:'2026-11-10T12:00:00Z' }] },
  { id:'beto', balance:700, predictions:[{ marketId:'m1', choice:'No', stake:300, date:'2026-11-11T12:00:00Z' }, { marketId:'otro', choice:'Sí', stake:25, date:'2026-11-11T12:00:00Z' }] }
];

test('pool sums stakes per side', () => {
  const all = accountsWithBets().flatMap(a => a.predictions).filter(p => rules.matches(p, market));
  assert.deepEqual(rules.pool(all), { yes:100, no:300, total:400 });
});
test('only the creator can resolve, once, and never demo markets', () => {
  assert.equal(rules.canResolve(market, 'ana'), true);
  assert.equal(rules.canResolve(market, 'beto'), false);
  assert.equal(rules.canResolve({ ...market, resolution:{ outcome:'Sí' } }, 'ana'), false);
  assert.equal(rules.canResolve({ ...market, demo:true }, 'ana'), false);
});
test('losers get nothing and winners get at least their stake back', () => {
  const pool = { yes:100, no:300, total:400 };
  assert.equal(rules.payout({ choice:'No', stake:300 }, 'Sí', pool), 0);
  const won = rules.payout({ choice:'Sí', stake:100 }, 'Sí', pool);
  assert.ok(Number.isInteger(won) && won >= 100);
});
test('settle marks results, credits winners and leaves other markets untouched', () => {
  const [ana, beto] = rules.settle(accountsWithBets(), market, 'Sí', '2026-11-14T00:00:00Z');
  assert.equal(ana.predictions[0].result, 'won');
  assert.equal(ana.balance, 900 + ana.predictions[0].payout);
  assert.equal(beto.predictions[0].result, 'lost');
  assert.equal(beto.predictions[0].payout, 0);
  assert.equal(beto.balance, 700);
  assert.equal(beto.predictions[1].result, undefined);
});
test('settling twice never pays twice', () => {
  const once = rules.settle(accountsWithBets(), market, 'Sí');
  const twice = rules.settle(once, market, 'Sí');
  assert.deepEqual(twice.map(a => a.balance), once.map(a => a.balance));
});
test('activity counts only unresolved predictions', () => {
  assert.deepEqual(rules.activity(accountsWithBets()), { staked:425, predictions:3 });
  assert.deepEqual(rules.activity(rules.settle(accountsWithBets(), market, 'No')), { staked:25, predictions:1 });
});

test('shared pool: winners split the whole pool by stake', () => {
  const pool = { yes:100, no:300, total:400 };
  assert.equal(rules.payout({ choice:'Sí', stake:100 }, 'Sí', pool), 400);
  const split = { yes:300, no:100, total:400 };
  assert.equal(rules.payout({ choice:'Sí', stake:100 }, 'Sí', split), 133);
  assert.equal(rules.payout({ choice:'Sí', stake:200 }, 'Sí', split), 266);
});
test('shared pool never pays out more than was staked', () => {
  const accounts = [
    { id:'a', balance:0, predictions:[{ marketId:'m1', choice:'Sí', stake:100 }] },
    { id:'b', balance:0, predictions:[{ marketId:'m1', choice:'Sí', stake:200 }] },
    { id:'c', balance:0, predictions:[{ marketId:'m1', choice:'No', stake:100 }] }
  ];
  const paid = rules.settle(accounts, market, 'Sí').reduce((sum, a) => sum + a.balance, 0);
  assert.ok(paid <= 400 && paid >= 398, `paid ${paid}`);
});
test('a lone winner with no opponents just gets the stake back', () => {
  assert.equal(rules.payout({ choice:'No', stake:75 }, 'No', { yes:0, no:75, total:75 }), 75);
});
