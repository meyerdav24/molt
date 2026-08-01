/**
 * OT-022 adversarial test suite. This is the claim the launch stands on:
 * no sequence of mints may exceed the root, and a child can never exceed
 * its parent on any dimension. Do not weaken these tests for time.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CHILD_DEFAULT_TTL_SECONDS,
  isSingleOrigin,
  matchesMerchantScope,
  mintChildMandate,
  validateNarrowing,
  type MintRequest,
  type ParentContext,
} from './mandate.js';
import type { MandateBounds } from './types.js';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const HOUR = 3600_000;
const CART = 'a'.repeat(64);

function rootBounds(overrides: Partial<MandateBounds> = {}): MandateBounds {
  return {
    amount_minor: 40000,
    currency: 'EUR',
    per_tx_max_minor: 15000,
    expires_at: new Date(NOW.getTime() + 7 * 24 * HOUR).toISOString(),
    mcc_allowlist: ['5943', '5732'],
    velocity_per_hour: 10,
    merchant_scope: '*',
    ...overrides,
  };
}

function parentCtx(
  bounds: MandateBounds = rootBounds(),
  extra: Partial<ParentContext> = {},
): ParentContext {
  return {
    tab_id: 'tab-1',
    parent_id: 'root-1',
    bounds,
    status: 'active',
    remaining_minor: bounds.amount_minor,
    recent_mint_times: [],
    ...extra,
  };
}

function req(overrides: Partial<MintRequest> = {}): MintRequest {
  return {
    merchant_origin: 'https://store.example.com',
    amount_minor: 3400,
    cart_hash: CART,
    reason: 'restock: usb-c hub',
    mcc: '5732',
    ...overrides,
  };
}

function expectFail(result: ReturnType<typeof mintChildMandate>, code: string) {
  assert.equal(result.ok, false, `expected mint to fail with ${code}`);
  if (!result.ok) {
    assert.ok(
      result.violations.some((v) => v.code === code),
      `expected violation ${code}, got: ${result.violations.map((v) => v.code).join(', ')}`,
    );
  }
}

// --- happy path establishes the shape everything else attacks -------------

test('successful mint produces a maximally narrow child', () => {
  const r = mintChildMandate(parentCtx(), req(), { now: NOW, id: 'child-1' });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.child.bounds.per_tx_max_minor, 3400);
    assert.equal(r.child.bounds.amount_minor, 3400);
    assert.equal(r.child.bounds.velocity_per_hour, 1);
    assert.deepEqual(r.child.bounds.mcc_allowlist, ['5732']);
    assert.equal(r.child.bounds.merchant_scope, 'https://store.example.com');
    assert.equal(r.child.status, 'pending');
    assert.equal(r.new_remaining_minor, 40000 - 3400);
    const ttlMs = Date.parse(r.child.bounds.expires_at) - NOW.getTime();
    assert.ok(ttlMs <= CHILD_DEFAULT_TTL_SECONDS * 1000, 'TTL must be <= 15 min');
    assert.equal(validateNarrowing(rootBounds(), r.child.bounds).length, 0);
  }
});

// --- amount attacks -------------------------------------------------------

test('amount above per-tx max is refused', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ amount_minor: 15001 }), { now: NOW, id: 'c' }),
    'amount_exceeds_per_tx_max',
  );
});

test('amount above remaining budget is refused', () => {
  const p = parentCtx(rootBounds(), { remaining_minor: 3000 });
  expectFail(
    mintChildMandate(p, req({ amount_minor: 3400 }), { now: NOW, id: 'c' }),
    'amount_exceeds_remaining',
  );
});

test('budget exactly exhausted: exact amount mints, one cent more refused', () => {
  const p = parentCtx(rootBounds(), { remaining_minor: 3400 });
  const exact = mintChildMandate(p, req({ amount_minor: 3400 }), { now: NOW, id: 'c1' });
  assert.ok(exact.ok);
  if (exact.ok) assert.equal(exact.new_remaining_minor, 0);
  const after = parentCtx(rootBounds(), { remaining_minor: 0 });
  expectFail(
    mintChildMandate(after, req({ amount_minor: 1 }), { now: NOW, id: 'c2' }),
    'amount_exceeds_remaining',
  );
});

test('off-by-one over remaining is refused', () => {
  const p = parentCtx(rootBounds(), { remaining_minor: 3399 });
  expectFail(
    mintChildMandate(p, req({ amount_minor: 3400 }), { now: NOW, id: 'c' }),
    'amount_exceeds_remaining',
  );
});

test('zero amount is refused', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ amount_minor: 0 }), { now: NOW, id: 'c' }),
    'amount_invalid',
  );
});

test('negative amount is refused', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ amount_minor: -100 }), { now: NOW, id: 'c' }),
    'amount_invalid',
  );
});

test('non-integer amount is refused (no float money)', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ amount_minor: 33.99 }), { now: NOW, id: 'c' }),
    'amount_invalid',
  );
});

test('unsafe-integer amount is refused', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ amount_minor: 2 ** 53 }), { now: NOW, id: 'c' }),
    'amount_invalid',
  );
});

// --- expiry attacks -------------------------------------------------------

test('expired parent cannot mint', () => {
  const bounds = rootBounds({ expires_at: new Date(NOW.getTime() - 1000).toISOString() });
  expectFail(mintChildMandate(parentCtx(bounds), req(), { now: NOW, id: 'c' }), 'parent_expired');
});

test('parent expiring exactly now cannot mint', () => {
  const bounds = rootBounds({ expires_at: NOW.toISOString() });
  expectFail(mintChildMandate(parentCtx(bounds), req(), { now: NOW, id: 'c' }), 'parent_expired');
});

test('child TTL is clamped to parent expiry', () => {
  const bounds = rootBounds({ expires_at: new Date(NOW.getTime() + 60_000).toISOString() });
  const r = mintChildMandate(parentCtx(bounds), req(), { now: NOW, id: 'c' });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.child.bounds.expires_at, bounds.expires_at);
});

test('validateNarrowing rejects child expiry beyond parent', () => {
  const parent = rootBounds();
  const child: MandateBounds = {
    ...parent,
    amount_minor: 100,
    per_tx_max_minor: 100,
    merchant_scope: 'https://store.example.com',
    velocity_per_hour: 1,
    expires_at: new Date(Date.parse(parent.expires_at) + 1000).toISOString(),
  };
  assert.ok(validateNarrowing(parent, child).some((v) => v.code === 'expiry_exceeds_parent'));
});

test('TTL longer than 15 minutes is refused', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ ttl_seconds: CHILD_DEFAULT_TTL_SECONDS + 1 }), {
      now: NOW,
      id: 'c',
    }),
    'ttl_invalid',
  );
});

// --- status attacks -------------------------------------------------------

test('revoked parent cannot mint', () => {
  expectFail(
    mintChildMandate(parentCtx(rootBounds(), { status: 'revoked' }), req(), { now: NOW, id: 'c' }),
    'parent_not_active',
  );
});

// --- MCC attacks ----------------------------------------------------------

test('MCC outside parent allowlist is refused', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ mcc: '7995' }), { now: NOW, id: 'c' }),
    'mcc_not_subset',
  );
});

test('validateNarrowing rejects child MCC superset', () => {
  const parent = rootBounds({ mcc_allowlist: ['5943'] });
  const child: MandateBounds = {
    amount_minor: 100,
    currency: 'EUR',
    per_tx_max_minor: 100,
    expires_at: parent.expires_at,
    mcc_allowlist: ['5943', '7995'],
    velocity_per_hour: 1,
    merchant_scope: 'https://store.example.com',
  };
  assert.ok(validateNarrowing(parent, child).some((v) => v.code === 'mcc_not_subset'));
});

// --- currency attacks -----------------------------------------------------

test('validateNarrowing rejects currency mismatch', () => {
  const parent = rootBounds();
  const child: MandateBounds = {
    ...parent,
    amount_minor: 100,
    per_tx_max_minor: 100,
    velocity_per_hour: 1,
    merchant_scope: 'https://store.example.com',
    currency: 'USD',
  };
  assert.ok(validateNarrowing(parent, child).some((v) => v.code === 'currency_mismatch'));
});

// --- velocity attacks -----------------------------------------------------

test('velocity limit reached within the hour blocks the mint', () => {
  const times = [1, 2].map((m) => new Date(NOW.getTime() - m * 60_000).toISOString());
  const p = parentCtx(rootBounds({ velocity_per_hour: 2 }), { recent_mint_times: times });
  expectFail(mintChildMandate(p, req(), { now: NOW, id: 'c' }), 'velocity_exceeded');
});

test('mints older than one hour do not count against velocity', () => {
  const times = [61, 90].map((m) => new Date(NOW.getTime() - m * 60_000).toISOString());
  const p = parentCtx(rootBounds({ velocity_per_hour: 2 }), { recent_mint_times: times });
  assert.ok(mintChildMandate(p, req(), { now: NOW, id: 'c' }).ok);
});

test('validateNarrowing rejects child velocity above parent', () => {
  const parent = rootBounds({ velocity_per_hour: 1 });
  const child: MandateBounds = {
    ...parent,
    amount_minor: 100,
    per_tx_max_minor: 100,
    merchant_scope: 'https://store.example.com',
    velocity_per_hour: 2,
  };
  assert.ok(validateNarrowing(parent, child).some((v) => v.code === 'velocity_exceeds_parent'));
});

// --- merchant scope attacks ----------------------------------------------

test('wildcard parent scope accepts any single origin', () => {
  assert.ok(
    mintChildMandate(parentCtx(), req({ merchant_origin: 'https://other.shop' }), {
      now: NOW,
      id: 'c',
    }).ok,
  );
});

test('exact parent scope accepts only that origin', () => {
  const bounds = rootBounds({ merchant_scope: 'https://store.example.com' });
  assert.ok(mintChildMandate(parentCtx(bounds), req(), { now: NOW, id: 'c1' }).ok);
  expectFail(
    mintChildMandate(parentCtx(bounds), req({ merchant_origin: 'https://evil.example.com' }), {
      now: NOW,
      id: 'c2',
    }),
    'merchant_scope_mismatch',
  );
});

test('denylisted merchant is refused even under wildcard scope', () => {
  const bounds = rootBounds({ merchant_denylist: ['https://store.example.com'] });
  expectFail(
    mintChildMandate(parentCtx(bounds), req(), { now: NOW, id: 'c' }),
    'merchant_denylisted',
  );
});

test('child scope with a path is not a single origin', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ merchant_origin: 'https://store.example.com/checkout' }), {
      now: NOW,
      id: 'c',
    }),
    'merchant_scope_not_single_origin',
  );
});

test('child cannot claim the wildcard scope', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ merchant_origin: '*' }), { now: NOW, id: 'c' }),
    'merchant_scope_not_single_origin',
  );
});

test('non-http(s) scheme is not a valid merchant origin', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ merchant_origin: 'javascript:alert(1)' }), {
      now: NOW,
      id: 'c',
    }),
    'merchant_scope_not_single_origin',
  );
});

// --- request hygiene ------------------------------------------------------

test('invalid cart hash is refused', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ cart_hash: 'beef' }), { now: NOW, id: 'c' }),
    'cart_hash_invalid',
  );
});

test('empty reason is refused', () => {
  expectFail(
    mintChildMandate(parentCtx(), req({ reason: '  ' }), { now: NOW, id: 'c' }),
    'reason_missing',
  );
});

test('failing mint reports the full violation list, not just the first', () => {
  const r = mintChildMandate(
    parentCtx(rootBounds(), { status: 'revoked' }),
    req({ amount_minor: -1, cart_hash: 'nope' }),
    { now: NOW, id: 'c' },
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    const codes = r.violations.map((v) => v.code);
    for (const c of ['parent_not_active', 'amount_invalid', 'cart_hash_invalid']) {
      assert.ok(codes.includes(c as never), `missing ${c}`);
    }
  }
});

// --- recursion: a child as parent ----------------------------------------

test('grandchild cannot exceed its child parent (recursive narrowing)', () => {
  const minted = mintChildMandate(parentCtx(), req(), { now: NOW, id: 'child-1' });
  assert.ok(minted.ok);
  if (minted.ok) {
    const childAsParent = parentCtx(minted.child.bounds, {
      parent_id: minted.child.id,
      remaining_minor: minted.child.bounds.amount_minor,
    });
    // more money than the child holds
    expectFail(
      mintChildMandate(childAsParent, req({ amount_minor: 3401 }), { now: NOW, id: 'gc' }),
      'amount_exceeds_remaining',
    );
    // different merchant than the child is scoped to
    expectFail(
      mintChildMandate(
        childAsParent,
        req({ merchant_origin: 'https://other.shop', amount_minor: 100 }),
        {
          now: NOW,
          id: 'gc2',
        },
      ),
      'merchant_scope_mismatch',
    );
  }
});

// --- helpers --------------------------------------------------------------

test('isSingleOrigin accepts origins, rejects everything else', () => {
  assert.ok(isSingleOrigin('https://store.example.com'));
  assert.ok(isSingleOrigin('http://localhost:3000'));
  assert.ok(!isSingleOrigin('https://store.example.com/'));
  assert.ok(!isSingleOrigin('store.example.com'));
  assert.ok(!isSingleOrigin('https://a.com?x=1'));
  assert.ok(!isSingleOrigin('ftp://a.com'));
});

test('matchesMerchantScope: wildcard and exact only', () => {
  assert.ok(matchesMerchantScope('*', 'https://a.com'));
  assert.ok(matchesMerchantScope('https://a.com', 'https://a.com'));
  assert.ok(!matchesMerchantScope('https://a.com', 'https://b.com'));
});

// --- property test: no sequence of mints can exceed the root total --------

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('property: no random mint sequence ever exceeds the root total', () => {
  for (let run = 0; run < 100; run++) {
    const rand = lcg(run * 2654435761 + 1);
    const total = 1 + Math.floor(rand() * 100_000);
    const perTx = 1 + Math.floor(rand() * total);
    const velocity = 1 + Math.floor(rand() * 20);
    const bounds = rootBounds({
      amount_minor: total,
      per_tx_max_minor: perTx,
      velocity_per_hour: velocity,
    });

    let remaining = total;
    let spent = 0;
    const mintTimes: string[] = [];

    for (let i = 0; i < 60; i++) {
      // adversarial amounts: cluster around the boundaries
      const roll = rand();
      const amount =
        roll < 0.25
          ? remaining + Math.floor(rand() * 100) // try to overdraw
          : roll < 0.5
            ? perTx + Math.floor(rand() * 100) // try to exceed per-tx
            : 1 + Math.floor(rand() * Math.max(1, perTx)); // plausible
      const now = new Date(NOW.getTime() + i * 30_000);
      const r = mintChildMandate(
        {
          tab_id: 't',
          parent_id: 'root',
          bounds,
          status: 'active',
          remaining_minor: remaining,
          recent_mint_times: mintTimes,
        },
        req({ amount_minor: amount }),
        { now, id: `c-${run}-${i}` },
      );
      if (r.ok) {
        remaining = r.new_remaining_minor;
        spent += r.child.bounds.amount_minor;
        mintTimes.push(now.toISOString());
        assert.equal(validateNarrowing(bounds, r.child.bounds).length, 0);
        assert.ok(r.child.bounds.amount_minor <= perTx);
      }
    }
    assert.ok(spent <= total, `run ${run}: spent ${spent} > root total ${total}`);
    assert.ok(remaining >= 0, `run ${run}: remaining went negative`);
    assert.equal(spent + remaining, total, `run ${run}: budget accounting drifted`);
  }
});
