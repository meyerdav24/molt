/**
 * One-command demo reset (OT-095): `pnpm demo:reset`
 *
 * Restores the demo account to a clean slate in seconds, so a failed take
 * costs a minute, not an evening:
 *
 *   1. cancels every still-active shell (Stripe test card) of the demo user,
 *      so no leftover card ever appears in the Stripe dashboard frame
 *   2. deletes the demo user's tabs - mandates, cards, receipts, agent keys
 *      and tab events cascade with them
 *   3. keeps the user and their passkey: no re-registration between takes
 *
 * The demo user is MOLT_DEMO_EMAIL from .env (or --email <addr>). Idempotent:
 * running it twice, or with no data to clear, is a no-op. Store carts need no
 * reset (the adapter clears the cart at the start of every run). The wallet
 * faucet refresh joins when Epic 11 lands.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const postgres = webRequire('postgres');
const Stripe = webRequire('stripe');

function env(name) {
  const m = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(
    new RegExp(`^${name}=(.+)$`, 'm'),
  );
  return m ? m[1] : undefined;
}

const started = Date.now();
const emailArg = process.argv.indexOf('--email');
const email =
  emailArg >= 0
    ? process.argv[emailArg + 1]
    : (process.env.MOLT_DEMO_EMAIL ?? env('MOLT_DEMO_EMAIL'));
if (!email) {
  console.error('demo:reset: set MOLT_DEMO_EMAIL in .env or pass --email <addr>');
  process.exit(1);
}

const stripeKey = env('STRIPE_API_KEY');
if (!stripeKey || !/^(sk|rk)_test_/.test(stripeKey)) {
  // G1: this script only ever touches a test-mode Stripe account.
  console.error('demo:reset: STRIPE_API_KEY in .env must be a test-mode key');
  process.exit(1);
}
const stripe = new Stripe(stripeKey);
const sql = postgres(env('DATABASE_URL'), { prepare: false, max: 2 });

try {
  const [user] = await sql`select id from users where email = ${email}`;
  if (!user) {
    console.log(`demo:reset: no user ${email} - nothing to clear (idempotent no-op)`);
    process.exit(0);
  }

  // 1. shed every shell that is still alive on Stripe's side
  const activeCards = await sql`
    select c.stripe_card_id from cards c
    join mandates m on m.id = c.mandate_id
    join tabs t on t.id = m.tab_id
    where t.user_id = ${user.id} and c.status = 'active'`;
  let canceled = 0;
  for (const { stripe_card_id } of activeCards) {
    try {
      await stripe.issuing.cards.update(stripe_card_id, { status: 'canceled' });
      canceled++;
    } catch (e) {
      // already-canceled cards are fine; anything else should be visible
      if (!/canceled/i.test(e.message ?? '')) {
        console.warn(`demo:reset: could not cancel ${stripe_card_id}: ${e.message}`);
      }
    }
  }

  // 2. clear the history: tabs cascade to mandates, cards, receipts and
  //    agent keys. The events audit log is append-only by design - deleting
  //    a tab anonymizes its events (FKs go NULL via cascade), which is
  //    exactly what a clean take needs: the dashboard renders events per
  //    tab, and anonymized rows belong to no tab.
  const tabs = await sql`delete from tabs where user_id = ${user.id} returning id`;

  console.log(
    `demo:reset: ${email} clean - ${tabs.length} tab(s) cleared, ` +
      `${canceled} shell(s) canceled on Stripe, passkey kept ` +
      `(${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
} finally {
  await sql.end();
}
