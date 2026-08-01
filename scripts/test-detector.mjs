/**
 * OT-051 AC: classify 10 known Shopify storefronts and 10 non-Shopify sites
 * against the live internet, with the honest Molt UA.
 *
 * Note: HEADLESS Shopify storefronts (own frontend, no /cart.js - e.g.
 * gymshark.com, fashionnova.com, ruggable.com) intentionally classify as
 * unknown/L2: the deterministic L1 adapter automates the classic storefront
 * checkout and cannot run against headless fronts. L2 is the correct rung
 * recommendation there, not a detection miss. Build the adapters
 * package first (pnpm --filter @molt/adapters build).
 *
 * Run from the repo root: node scripts/test-detector.mjs
 */
import { clearDetectionCache, resolveMerchant } from '../packages/adapters/dist/detector.js';

const SHOPIFY = [
  'https://www.allbirds.com',
  'https://www.rothys.com',
  'https://colourpop.com',
  'https://kyliecosmetics.com',
  'https://www.untuckit.com',
  'https://www.taylorstitch.com',
  'https://www.brooklinen.com',
  'https://www.chubbiesshorts.com',
  'https://www.deathwishcoffee.com',
  'https://www.tentree.com',
];

const NON_SHOPIFY = [
  'https://www.amazon.com',
  'https://www.apple.com',
  'https://www.wikipedia.org',
  'https://github.com',
  'https://www.ebay.com',
  'https://www.zalando.de',
  'https://www.otto.de',
  'https://www.ikea.com',
  'https://www.etsy.com',
  'https://www.mediamarkt.de',
];

clearDetectionCache();
let pass = 0;
let fail = 0;
let unreachable = 0;

async function check(url, expected) {
  try {
    const r = await resolveMerchant(url, { timeoutMs: 12000, noCache: true });
    const got = r.platform === 'shopify' ? 'shopify' : 'non-shopify';
    const ok = got === expected;
    if (ok) pass++;
    else fail++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${url} -> ${r.platform} (${r.recommended_rung}) [${r.signals.join(', ') || 'no signals'}]`,
    );
  } catch {
    unreachable++;
    console.log(`skip ${url} (unreachable)`);
  }
}

for (const url of SHOPIFY) await check(url, 'shopify');
for (const url of NON_SHOPIFY) await check(url, 'non-shopify');

console.log(`\n${pass} correct, ${fail} wrong, ${unreachable} unreachable`);
if (fail > 0) process.exitCode = 1;
