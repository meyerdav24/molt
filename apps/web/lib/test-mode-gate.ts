/**
 * The hard test-mode gate (OT-080, guardrail G1): no funds ever flow through
 * Molt. `MOLT_MODE=test` is the only mode the hosted beta and the default
 * config support, and in test mode every Stripe key MUST be a test key -
 * the server refuses to boot otherwise.
 *
 * Live mode exists only for self-hosters who bring their own issuer
 * relationship. It requires BOTH:
 *
 *   MOLT_MODE=live
 *   MOLT_LIVE_ACK="I operate my own issuer relationship and accept full responsibility"
 *
 * (the exact sentence, verbatim). Without the acknowledgement the boot is
 * refused. This flag is deliberately loud: turning it on is a statement
 * about who carries the regulatory relationship, not a config tweak.
 */

export const LIVE_ACK_SENTENCE =
  'I operate my own issuer relationship and accept full responsibility';

const TEST_KEY = /^(sk|rk)_test_/;

export interface GateResult {
  mode: 'test' | 'live';
}

/** Throws with a plain-language reason if the configuration violates G1. */
export function assertTestMode(env: Record<string, string | undefined>): GateResult {
  const mode = env.MOLT_MODE ?? 'test';

  if (mode === 'test') {
    const key = env.STRIPE_API_KEY;
    // A missing key only disables card features; a live-shaped key is a
    // G1 violation and stops the boot.
    if (key !== undefined && key !== '' && !TEST_KEY.test(key)) {
      throw new Error(
        'G1 violation: MOLT_MODE=test but STRIPE_API_KEY is not a test-mode key ' +
          '(sk_test_/rk_test_). Refusing to start. No funds ever flow through Molt in test mode.',
      );
    }
    return { mode: 'test' };
  }

  if (mode === 'live') {
    if (env.MOLT_LIVE_ACK !== LIVE_ACK_SENTENCE) {
      throw new Error(
        'MOLT_MODE=live requires the explicit acknowledgement MOLT_LIVE_ACK=' +
          `"${LIVE_ACK_SENTENCE}" (verbatim). Live mode is for self-hosters who bring ` +
          'their own issuer relationship; the hosted beta never runs live. Refusing to start.',
      );
    }
    return { mode: 'live' };
  }

  throw new Error(
    `MOLT_MODE="${mode}" is not a mode. Supported: "test" (default) or "live" ` +
      '(self-hosters only, requires MOLT_LIVE_ACK).',
  );
}
