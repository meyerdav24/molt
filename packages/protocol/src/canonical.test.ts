import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canonicalJson, sha256CanonicalHex } from './canonical.js';

test('sorts object keys at every depth', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
    '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
  );
});

test('key order does not change the hash', () => {
  assert.equal(
    sha256CanonicalHex({ amount_minor: 3400, currency: 'EUR' }),
    sha256CanonicalHex({ currency: 'EUR', amount_minor: 3400 }),
  );
});

test('any value change changes the hash', () => {
  assert.notEqual(
    sha256CanonicalHex({ amount_minor: 3400 }),
    sha256CanonicalHex({ amount_minor: 3401 }),
  );
});

test('drops undefined object members, nulls undefined array slots', () => {
  assert.equal(canonicalJson({ a: undefined, b: [undefined] }), '{"b":[null]}');
});

test('rejects non-finite numbers', () => {
  assert.throws(() => canonicalJson({ a: Infinity }), TypeError);
  assert.throws(() => canonicalJson(NaN), TypeError);
});
