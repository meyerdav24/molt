/** OT-023: every trigger covered, severity combination, baseline logic. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  AMOUNT_PER_TX_FRACTION,
  BASELINE_MIN_SAMPLES,
  evaluatePolicy,
  type PolicyContext,
} from './policy.js';
import type { MandateBounds, StepUpPolicy } from './types.js';

const NOW = new Date('2026-08-01T12:00:00.000Z');

const BOUNDS: MandateBounds = {
  amount_minor: 40000,
  currency: 'EUR',
  per_tx_max_minor: 15000,
  expires_at: new Date(NOW.getTime() + 7 * 24 * 3600_000).toISOString(),
  mcc_allowlist: ['5943', '5732'],
  velocity_per_hour: 3,
  merchant_scope: '*',
};

const POLICY: StepUpPolicy = {
  unknown_merchant: 'require_tap',
  amount_above_baseline: 'notify',
  mcc_outside_allowlist: 'block',
  velocity_exceeded: 'block',
};

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    policy: POLICY,
    bounds: BOUNDS,
    known_merchants: ['https://known.shop'],
    recent_amounts_minor: [],
    recent_mint_times: [],
    now: NOW,
    ...overrides,
  };
}

test('clean request from a known merchant auto-approves with no triggers', () => {
  const d = evaluatePolicy(ctx(), {
    merchant_origin: 'https://known.shop',
    amount_minor: 1000,
    mcc: '5943',
  });
  assert.equal(d.outcome, 'auto_approve');
  assert.equal(d.triggers.length, 0);
});

test('unknown merchant fires and maps to the configured action', () => {
  const d = evaluatePolicy(ctx(), { merchant_origin: 'https://new.shop', amount_minor: 1000 });
  assert.equal(d.outcome, 'hold_for_tap');
  assert.equal(d.triggers[0]?.trigger, 'unknown_merchant');
  assert.ok(d.triggers[0]?.reason.includes('https://new.shop'));
});

test('amount above the per-tx fraction fires amount_above_baseline', () => {
  const limit = Math.floor(BOUNDS.per_tx_max_minor * AMOUNT_PER_TX_FRACTION);
  const under = evaluatePolicy(ctx(), {
    merchant_origin: 'https://known.shop',
    amount_minor: limit,
  });
  assert.equal(under.triggers.length, 0);
  const over = evaluatePolicy(ctx(), {
    merchant_origin: 'https://known.shop',
    amount_minor: limit + 1,
  });
  assert.equal(over.outcome, 'notify');
  assert.equal(over.triggers[0]?.trigger, 'amount_above_baseline');
});

test('rolling baseline: >3x median fires once enough history exists', () => {
  const history = { recent_amounts_minor: [1000, 1200, 1400] };
  const over = evaluatePolicy(ctx(history), {
    merchant_origin: 'https://known.shop',
    amount_minor: 3601, // median 1200 * 3 = 3600
  });
  assert.equal(over.triggers[0]?.trigger, 'amount_above_baseline');
  assert.ok(over.triggers[0]?.reason.includes('median'));
  const under = evaluatePolicy(ctx(history), {
    merchant_origin: 'https://known.shop',
    amount_minor: 3600,
  });
  assert.equal(under.triggers.length, 0);
});

test('rolling baseline stays silent below the minimum sample count', () => {
  const d = evaluatePolicy(
    ctx({ recent_amounts_minor: Array(BASELINE_MIN_SAMPLES - 1).fill(100) }),
    {
      merchant_origin: 'https://known.shop',
      amount_minor: 5000,
    },
  );
  assert.equal(d.triggers.length, 0);
});

test('MCC outside allowlist fires; unknown MCC does not', () => {
  const outside = evaluatePolicy(ctx(), {
    merchant_origin: 'https://known.shop',
    amount_minor: 1000,
    mcc: '7995',
  });
  assert.equal(outside.outcome, 'block');
  assert.equal(outside.triggers[0]?.trigger, 'mcc_outside_allowlist');
  const unknown = evaluatePolicy(ctx(), {
    merchant_origin: 'https://known.shop',
    amount_minor: 1000,
  });
  assert.equal(unknown.triggers.length, 0);
});

test('velocity at the limit fires; old mints do not count', () => {
  const recent = [1, 2, 3].map((m) => new Date(NOW.getTime() - m * 60_000).toISOString());
  const d = evaluatePolicy(ctx({ recent_mint_times: recent }), {
    merchant_origin: 'https://known.shop',
    amount_minor: 1000,
  });
  assert.equal(d.outcome, 'block');
  assert.equal(d.triggers[0]?.trigger, 'velocity_exceeded');

  const old = [61, 90, 120].map((m) => new Date(NOW.getTime() - m * 60_000).toISOString());
  const ok = evaluatePolicy(ctx({ recent_mint_times: old }), {
    merchant_origin: 'https://known.shop',
    amount_minor: 1000,
  });
  assert.equal(ok.triggers.length, 0);
});

test('strictest fired action wins; all triggers are reported', () => {
  // unknown merchant (require_tap) + MCC outside (block) -> block, 2 triggers
  const d = evaluatePolicy(ctx(), {
    merchant_origin: 'https://new.shop',
    amount_minor: 1000,
    mcc: '7995',
  });
  assert.equal(d.outcome, 'block');
  assert.equal(d.triggers.length, 2);
});

test('a trigger configured allow fires visibly but still auto-approves', () => {
  const policy: StepUpPolicy = { ...POLICY, unknown_merchant: 'allow' };
  const d = evaluatePolicy(ctx({ policy }), {
    merchant_origin: 'https://new.shop',
    amount_minor: 1000,
  });
  assert.equal(d.outcome, 'auto_approve');
  assert.equal(d.triggers.length, 1); // still logged for the audit trail
});

test('notify does not out-rank require_tap', () => {
  const policy: StepUpPolicy = { ...POLICY, amount_above_baseline: 'notify' };
  const d = evaluatePolicy(ctx({ policy }), {
    merchant_origin: 'https://new.shop', // require_tap
    amount_minor: 14000, // notify (above fraction)
  });
  assert.equal(d.outcome, 'hold_for_tap');
  assert.equal(d.triggers.length, 2);
});
