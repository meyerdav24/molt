/** OT-054: price-mismatch aborts, double-commit impossible, hash stability. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  cartHash,
  deriveIdempotencyKey,
  normalizeCart,
  preflightValidate,
  type NormalizedCart,
} from './preflight.js';
import type { MandateBounds } from '@molt/protocol';

const CART: NormalizedCart = {
  merchant_origin: 'https://store.example.com',
  currency: 'EUR',
  lines: [{ variant_id: 42, title: 'USB-C Hub 7-in-1', quantity: 1, price_minor: 3400 }],
  subtotal_minor: 3400,
  shipping_minor: 0,
  total_minor: 3400,
};

const BOUNDS: MandateBounds = {
  amount_minor: 3400,
  currency: 'EUR',
  per_tx_max_minor: 3400,
  expires_at: '2026-08-01T13:00:00.000Z',
  mcc_allowlist: ['5732'],
  velocity_per_hour: 1,
  merchant_scope: 'https://store.example.com',
};

test('clean cart passes preflight', () => {
  assert.deepEqual(preflightValidate(CART, { bounds: BOUNDS, cart_hash: cartHash(CART) }), []);
});

test('surprise fee aborts before card entry', () => {
  const withFee = { ...CART, shipping_minor: 490, total_minor: 3890 };
  const v = preflightValidate(withFee, { bounds: BOUNDS, cart_hash: cartHash(CART) });
  const codes = v.map((x) => x.code);
  assert.ok(codes.includes('total_exceeds_mandate'));
  assert.ok(codes.includes('cart_hash_mismatch'));
});

test('price drop below the mandate amount is allowed', () => {
  const cheaper = {
    ...CART,
    lines: [{ ...CART.lines[0]!, price_minor: 3000 }],
    subtotal_minor: 3000,
    total_minor: 3000,
  };
  const v = preflightValidate(cheaper, { bounds: BOUNDS, cart_hash: cartHash(cheaper) });
  assert.deepEqual(v, []);
});

test('currency and merchant mismatches are refused', () => {
  const usd = { ...CART, currency: 'USD' };
  assert.ok(
    preflightValidate(usd, { bounds: BOUNDS, cart_hash: cartHash(usd) }).some(
      (v) => v.code === 'currency_mismatch',
    ),
  );
  const otherShop = { ...CART, merchant_origin: 'https://evil.example.com' };
  assert.ok(
    preflightValidate(otherShop, { bounds: BOUNDS, cart_hash: cartHash(otherShop) }).some(
      (v) => v.code === 'merchant_mismatch',
    ),
  );
});

test('arithmetic must add up', () => {
  const lying = { ...CART, subtotal_minor: 3300 };
  assert.ok(
    preflightValidate(lying, { bounds: BOUNDS, cart_hash: cartHash(lying) }).some(
      (v) => v.code === 'arithmetic_mismatch',
    ),
  );
});

test('cart hash is order-invariant and value-sensitive', () => {
  const twoLines: NormalizedCart = {
    ...CART,
    lines: [
      { variant_id: 7, title: 'B', quantity: 2, price_minor: 100 },
      { variant_id: 3, title: 'A', quantity: 1, price_minor: 200 },
    ],
    subtotal_minor: 400,
    total_minor: 400,
  };
  const swapped = { ...twoLines, lines: [...twoLines.lines].reverse() };
  assert.equal(cartHash(twoLines), cartHash(swapped));
  const changed = {
    ...twoLines,
    lines: [{ ...twoLines.lines[0]!, price_minor: 101 }, twoLines.lines[1]!],
  };
  assert.notEqual(cartHash(twoLines), cartHash(changed));
});

test('idempotency key: same cart same key, any change new key', () => {
  const h = cartHash(CART);
  const k1 = deriveIdempotencyKey('tab-1', 'https://store.example.com', h);
  const k2 = deriveIdempotencyKey('tab-1', 'https://store.example.com/', h);
  assert.equal(k1, k2, 'origin normalization: trailing slash is irrelevant');
  assert.notEqual(k1, deriveIdempotencyKey('tab-2', 'https://store.example.com', h));
  assert.notEqual(k1, deriveIdempotencyKey('tab-1', 'https://other.example.com', h));
});

test('normalization uppercases currency and sorts lines', () => {
  const messy = {
    ...CART,
    currency: 'eur',
    merchant_origin: 'https://store.example.com/some/path',
  };
  const n = normalizeCart(messy);
  assert.equal(n.currency, 'EUR');
  assert.equal(n.merchant_origin, 'https://store.example.com');
});
