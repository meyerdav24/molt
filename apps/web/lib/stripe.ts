import Stripe from 'stripe';

let client: Stripe | undefined;

import { assertTestMode } from './test-mode-gate';

/**
 * Stripe client behind the test-mode gate (OT-080, guardrail G1). The boot
 * gate in instrumentation.ts already refused bad configs; this re-checks at
 * call time as defense in depth. In test mode every key MUST be a test key.
 * Only a self-hosted live deployment (MOLT_MODE=live + verbatim
 * MOLT_LIVE_ACK) may hold a live key - and that deployment operates its own
 * issuer relationship.
 */
export function stripe(): Stripe {
  if (!client) {
    const { mode } = assertTestMode(process.env);
    const key = process.env.STRIPE_API_KEY;
    if (!key) throw new Error('STRIPE_API_KEY is not set');
    if (mode === 'test' && !/^(sk|rk)_test_/.test(key)) {
      throw new Error('G1 violation: STRIPE_API_KEY must be a test-mode key (sk_test_/rk_test_)');
    }
    client = new Stripe(key);
  }
  return client;
}
