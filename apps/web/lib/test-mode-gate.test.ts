/**
 * OT-080 AC: the app refuses to boot with a live-shaped key in default mode.
 * Runs with the node:test runner via native type stripping (Node 22.18+).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTestMode, LIVE_ACK_SENTENCE } from './test-mode-gate.ts';

test('default mode is test, test keys pass', () => {
  assert.deepEqual(assertTestMode({ STRIPE_API_KEY: 'sk_test_abc' }), { mode: 'test' });
  assert.deepEqual(assertTestMode({ MOLT_MODE: 'test', STRIPE_API_KEY: 'rk_test_abc' }), {
    mode: 'test',
  });
});

test('missing key boots (features fail later, boot does not)', () => {
  assert.deepEqual(assertTestMode({}), { mode: 'test' });
  assert.deepEqual(assertTestMode({ STRIPE_API_KEY: '' }), { mode: 'test' });
});

test('live-shaped key in test mode refuses to boot', () => {
  for (const key of ['sk_live_abc', 'rk_live_abc', 'sk_livetest_x', 'pk_test_notasecret']) {
    assert.throws(() => assertTestMode({ STRIPE_API_KEY: key }), /G1 violation/);
    assert.throws(() => assertTestMode({ MOLT_MODE: 'test', STRIPE_API_KEY: key }), /G1 violation/);
  }
});

test('live mode without the verbatim acknowledgement refuses to boot', () => {
  assert.throws(() => assertTestMode({ MOLT_MODE: 'live' }), /MOLT_LIVE_ACK/);
  assert.throws(() => assertTestMode({ MOLT_MODE: 'live', MOLT_LIVE_ACK: 'yes' }), /MOLT_LIVE_ACK/);
  assert.throws(
    () =>
      assertTestMode({
        MOLT_MODE: 'live',
        MOLT_LIVE_ACK: LIVE_ACK_SENTENCE.toUpperCase(),
      }),
    /MOLT_LIVE_ACK/,
  );
});

test('live mode with the verbatim acknowledgement boots', () => {
  assert.deepEqual(
    assertTestMode({
      MOLT_MODE: 'live',
      MOLT_LIVE_ACK: LIVE_ACK_SENTENCE,
      STRIPE_API_KEY: 'sk_live_selfhosted',
    }),
    { mode: 'live' },
  );
});

test('unknown modes refuse to boot', () => {
  for (const mode of ['production', 'dev', 'TEST', 'Live', ' ']) {
    assert.throws(() => assertTestMode({ MOLT_MODE: mode }), /not a mode/);
  }
});
