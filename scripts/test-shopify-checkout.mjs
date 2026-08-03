/**
 * OT-052 test runner: real checkout(s) against the dev stores in
 * MOLT_TEST_SHOPIFY_STORES (.env). Bogus Gateway card "1" = success.
 *
 *   node scripts/test-shopify-checkout.mjs            # one run
 *   node scripts/test-shopify-checkout.mjs 20         # the 90%-gate series
 */
import { readFileSync } from 'node:fs';
import { shopifyCheckout } from '../packages/adapters/dist/shopify.js';

function env(name) {
  const m = readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`${name} not in .env`);
  return m[1];
}

const stores = env('MOLT_TEST_SHOPIFY_STORES')
  .split(',')
  .map((s) => {
    const [url, password] = s.trim().split('|');
    return { url, password };
  });

const runs = Number(process.argv[2] ?? 1);
// Alternate across configured stores unless one is pinned: halves the
// per-store request rate and exercises both themes (real robustness signal).
const pinned = process.env.STORE_INDEX !== undefined ? Number(process.env.STORE_INDEX) : null;
const CATALOG = {
  'brightside-office-supply.myshopify.com': { variant_id: 50283551555823, total_minor: 3400 },
  'harborview-electronics.myshopify.com': { variant_id: 54518565372179, total_minor: 900 },
};

function buildRequest(store) {
  const host = new URL(store.url).hostname;
  const item = CATALOG[host] ?? {
    variant_id: Number(process.env.VARIANT_ID),
    total_minor: Number(process.env.TOTAL_MINOR),
  };
  return {
    store_url: store.url,
    storefront_password: store.password,
    items: [{ variant_id: item.variant_id, quantity: 1 }],
    shipping: {
      email: 'demo@moltprotocol.dev',
      first_name: 'Molt',
      last_name: 'Demo',
      address1: 'Teststr. 1',
      city: 'Munich',
      zip: '80331',
      country_code: 'DE',
      phone: '+4915212345678',
    },
    card: { number: '1', exp_month: 12, exp_year: 2030, cvc: '123', name: 'Molt Demo' },
    expected_total_minor: item.total_minor,
    evidence_dir: process.env.EVIDENCE_DIR ?? '/tmp/molt-evidence',
    session_state_path:
      (process.env.EVIDENCE_DIR ?? '/tmp/molt-evidence') + '/session-' + host + '.json',
  };
}

// Pace runs: a real agent buys a handful of times an hour, not many times a
// minute. Spacing keeps the series inside merchant rate limits (the adapter
// additionally backs off on 429).
const PACE_MS = Number(process.env.PACE_MS ?? (runs > 1 ? 45000 : 0));

let okCount = 0;
for (let i = 1; i <= runs; i++) {
  if (i > 1 && PACE_MS > 0) await new Promise((r) => setTimeout(r, PACE_MS));
  const started = Date.now();
  const store = pinned !== null ? stores[pinned] : stores[(i - 1) % stores.length];
  const result = await shopifyCheckout(buildRequest(store));
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (result.ok) {
    okCount++;
    console.log(
      `run ${i}/${runs} [${new URL(store.url).hostname.split('.')[0]}]: ok in ${secs}s -> ${result.order_confirmation.slice(0, 60)}`,
    );
  } else {
    console.log(
      `run ${i}/${runs} [${new URL(store.url).hostname.split('.')[0]}]: FAIL in ${secs}s @ ${result.stage}: ${result.reason} - ${result.detail.slice(0, 160)}`,
    );
  }
}
console.log(`\n${okCount}/${runs} successful (${((okCount / runs) * 100).toFixed(0)}%)`);
if (okCount / runs < 0.9) process.exitCode = 1;
