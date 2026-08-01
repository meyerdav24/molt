import { assertTestMode } from './lib/test-mode-gate';

/**
 * Boot gate (OT-080): runs once when the server starts, before any request.
 * A misconfigured mode or a live-shaped Stripe key in test mode kills the
 * process here, not on the first payment call.
 */
export async function register(): Promise<void> {
  const { mode } = assertTestMode(process.env);
  console.warn(`molt-tab-authority: mode=${mode}${mode === 'live' ? ' (self-hosted live)' : ''}`);
}
