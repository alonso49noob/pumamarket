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

const sequence = values => { let n = 0; return () => values[n++ % values.length]; };
const bytes = (...list) => Uint8Array.from(list);

test('wallet addresses are 16 hex characters, unique and tolerant to formatting', () => {
  const wallet = rules.newWallet([], () => bytes(0xab, 0xcd, 0x01, 0x23, 0x45, 0x67, 0x89, 0xef));
  assert.equal(wallet, 'ABCD0123456789EF');
  assert.equal(rules.formatWallet(wallet), 'ABCD-0123-4567-89EF');
  assert.equal(rules.normalizeWallet(' abcd-0123 4567-89ef '), wallet);
  for (const bad of ['', 'ABCD', 'ABCD0123456789EG', 'ABCD0123456789EF0']) assert.equal(rules.normalizeWallet(bad), null);
  const next = rules.newWallet([{ wallet }], sequence([bytes(0xab, 0xcd, 0x01, 0x23, 0x45, 0x67, 0x89, 0xef), bytes(0, 0, 0, 0, 0, 0, 0, 1)]));
  assert.equal(next, '0000000000000001');
});
test('existing accounts get a wallet once and keep it afterwards', () => {
  const random = sequence([bytes(1, 1, 1, 1, 1, 1, 1, 1), bytes(2, 2, 2, 2, 2, 2, 2, 2)]);
  const first = rules.assignWallets([{ id:'a' }, { id:'b', wallet:'0101010101010101' }], random);
  assert.equal(first[1].wallet, '0101010101010101');
  assert.equal(first[0].wallet, '0202020202020202');
  assert.deepEqual(rules.assignWallets(first, random), first);
});
const walletAccounts = () => [
  { id:'ana', name:'ana', wallet:'AAAAAAAAAAAAAAAA', balance:500, phoneVerified:{ at:'2026-11-14T00:00:00Z' } },
  { id:'beto', name:'beto', wallet:'BBBBBBBBBBBBBBBB', balance:100 }
];
test('transfer moves points and records both sides', () => {
  const { accounts, error } = rules.transfer(walletAccounts(), 'ana', 'bbbb-bbbb-bbbb-bbbb', 200, { id:'t1', date:'2026-11-14T00:00:00Z' });
  assert.equal(error, '');
  assert.deepEqual(accounts.map(a => a.balance), [300, 300]);
  assert.equal(accounts[0].transfers[0].type, 'out');
  assert.equal(accounts[0].transfers[0].name, 'beto');
  assert.equal(accounts[1].transfers[0].type, 'in');
  assert.equal(accounts[1].transfers[0].wallet, 'AAAAAAAAAAAAAAAA');
});
test('invalid transfers change nothing', () => {
  const cases = [
    ['ana', 'BBBB', 10, /16 caracteres/],
    ['ana', 'CCCCCCCCCCCCCCCC', 10, /ninguna cuenta/],
    ['ana', 'AAAAAAAAAAAAAAAA', 10, /propia cuenta/],
    ['ana', 'BBBBBBBBBBBBBBBB', 0, /entera/],
    ['ana', 'BBBBBBBBBBBBBBBB', 2.5, /entera/],
    ['ana', 'BBBBBBBBBBBBBBBB', 501, /saldo suficiente/],
    ['nadie', 'BBBBBBBBBBBBBBBB', 10, /Inicia sesión/]
  ];
  for (const [from, to, amount, message] of cases) {
    const before = walletAccounts();
    const result = rules.transfer(before, from, to, amount);
    assert.match(result.error, message);
    assert.equal(result.accounts, before);
  }
});
test('circulating supply counts balances plus open stakes only', () => {
  const accounts = [
    { balance:50, predictions:[{ stake:25 }, { stake:100, result:'lost' }] },
    { balance:100, predictions:[] },
    { predictions:[{ stake:25 }] }
  ];
  assert.equal(rules.circulating(accounts), 200);
});
test('every new account dilutes the CLP value of each point', () => {
  const one = rules.clpPerPoint(rules.STARTING_POINTS);
  const two = rules.clpPerPoint(2 * rules.STARTING_POINTS);
  assert.equal(one, rules.REFERENCE_FUND_CLP / rules.STARTING_POINTS);
  assert.equal(two, one / 2);
  assert.equal(rules.toCLP(rules.STARTING_POINTS, rules.STARTING_POINTS), rules.REFERENCE_FUND_CLP);
  assert.equal(rules.clpPerPoint(0), one);
});
test('transfers and predictions do not inflate, resolutions can only shrink supply', () => {
  const before = walletAccounts();
  const moved = rules.transfer(before, 'ana', 'BBBBBBBBBBBBBBBB', 200).accounts;
  assert.equal(rules.circulating(moved), rules.circulating(before));
  const bets = accountsWithBets();
  const settled = rules.settle(bets, market, 'Sí');
  assert.ok(rules.circulating(settled) <= rules.circulating(bets));
});
test('supply log only records changes', () => {
  let log = rules.logSupply([], 100, '2026-11-01T00:00:00Z', 'inicio');
  log = rules.logSupply(log, 100, '2026-11-02T00:00:00Z', 'ajuste');
  log = rules.logSupply(log, 200, '2026-11-03T00:00:00Z', 'nueva cuenta');
  assert.deepEqual(log.map(entry => entry.supply), [100, 200]);
  assert.equal(log[1].reason, 'nueva cuenta');
});

const { subtle } = globalThis.crypto;
const keyPair = async () => {
  const pair = await subtle.generateKey(rules.VERIFY_ALGORITHM, true, ['sign', 'verify']);
  return { privateJwk:await subtle.exportKey('jwk', pair.privateKey), publicJwk:await subtle.exportKey('jwk', pair.publicKey) };
};

test('a signed link verifies only the phone it was made for', async () => {
  const { privateJwk, publicJwk } = await keyPair();
  const signature = await rules.signPhone('+56 9 1234 5678', privateJwk, subtle);
  const link = rules.verificationLink('https://example.test/', '+56912345678', signature);
  const parsed = rules.parseVerification(new URL(link).hash);
  assert.equal(parsed.phone, '+56912345678');
  assert.equal(await rules.verifyPhone('0056 9 1234 5678', parsed.signature, publicJwk, subtle), true);
  assert.equal(await rules.verifyPhone('+56912345679', parsed.signature, publicJwk, subtle), false);
});
test('a signature from another key or a tampered signature is rejected', async () => {
  const mine = await keyPair(), theirs = await keyPair();
  const signature = await rules.signPhone('+56912345678', theirs.privateJwk, subtle);
  assert.equal(await rules.verifyPhone('+56912345678', signature, mine.publicJwk, subtle), false);
  const good = await rules.signPhone('+56912345678', mine.privateJwk, subtle);
  const flipped = (good[0] === 'A' ? 'B' : 'A') + good.slice(1);
  assert.equal(await rules.verifyPhone('+56912345678', flipped, mine.publicJwk, subtle), false);
  assert.equal(await rules.verifyPhone('+56912345678', 'no-es-base64!', mine.publicJwk, subtle), false);
  assert.equal(await rules.verifyPhone('+56912345678', good, undefined, subtle), false);
});
test('only well-formed verification links are parsed', () => {
  assert.equal(rules.parseVerification('#mercado/abc'), null);
  assert.equal(rules.parseVerification('#verificar/123/abc'), null);
  assert.equal(rules.parseVerification(`#verificar/56912345678/${'x'.repeat(86)}`).phone, '+56912345678');
});
test('unverified accounts cannot send points', () => {
  const accounts = walletAccounts().map(item => ({ ...item, phoneVerified:null }));
  const result = rules.transfer(accounts, 'ana', 'BBBBBBBBBBBBBBBB', 10);
  assert.match(result.error, /Verifica tu teléfono/);
  assert.equal(result.accounts, accounts);
});
test('base64url round-trips arbitrary bytes', () => {
  const bytes = Uint8Array.from([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
  assert.deepEqual(rules.fromBase64url(rules.base64url(bytes)), bytes);
});
