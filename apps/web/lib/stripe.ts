import Stripe from 'stripe';

let client: Stripe | undefined;

/**
 * Stripe client with the test-mode gate (guardrail G1, hard gate lands fully
 * in OT-080): every key MUST be a test key. A live-shaped key throws before
 * any call is made.
 */
export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_API_KEY;
    if (!key) throw new Error('STRIPE_API_KEY is not set');
    if (!/^(sk|rk)_test_/.test(key)) {
      throw new Error('G1 violation: STRIPE_API_KEY must be a test-mode key (sk_test_/rk_test_)');
    }
    client = new Stripe(key);
  }
  return client;
}
