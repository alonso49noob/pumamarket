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
