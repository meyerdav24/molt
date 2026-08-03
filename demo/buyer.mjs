/**
 * Demo buyer (the earn scene, storyboard 0:05-0:20): pays the demo seller's
 * paid endpoint N times from the BUYER wallet, printing the visible
 * 402 -> payment -> 200 rhythm the split screen wants. The agent wallet
 * (the seller's pay-to) earns; the dashboard balance ticks up.
 *
 *   node demo/buyer.mjs [count] [url]
 *
 * Defaults: 3 payments against http://localhost:4021/quote, buyer wallet
 * from MOLT_BUYER_WALLET_PATH (.env), passphrase from MOLT_WALLET_PASSPHRASE.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const adapters = await import('../packages/adapters/dist/index.js');
createRequire(import.meta.url); // keep node happy about mixed resolution

function env(name) {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const m = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(
    new RegExp(`^${name}=(.+)$`, 'm'),
  );
  if (!m) throw new Error(`${name} not set (env or .env)`);
  return m[1];
}

const count = Number(process.argv[2] ?? 3);
const url = process.argv[3] ?? 'http://localhost:4021/quote';
const account = adapters.loadWallet(env('MOLT_BUYER_WALLET_PATH'), env('MOLT_WALLET_PASSPHRASE'));

console.log(`buyer ${account.address} -> ${url}\n`);
for (let i = 1; i <= count; i++) {
  const probe = await fetch(url);
  console.log(`[${i}/${count}] GET ${new URL(url).pathname} -> ${probe.status} Payment Required`);
  const out = await adapters.fetchWithX402(url, { account, maxAmountMinor: 100_000n });
  if (out.ok && out.paid) {
    console.log(
      `[${i}/${count}]   paid ${(Number(out.amount_minor) / 1e6).toFixed(2)} USDC -> ${out.status} OK  tx ${out.settlement?.transaction?.slice(0, 18)}…`,
    );
    console.log(`[${i}/${count}]   "${JSON.parse(out.body).quote}"\n`);
  } else {
    console.log(`[${i}/${count}]   failed: ${out.ok ? out.status : out.reason}\n`);
    process.exitCode = 1;
  }
}
