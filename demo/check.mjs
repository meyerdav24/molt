/**
 * Film-day preflight (`pnpm demo:check`): everything a take depends on,
 * checked in one pass so no take dies to avoidable setup. Read-only except
 * for one /cart.js probe per store; safe to run any time.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { usdcBalance } = await import('../packages/adapters/dist/wallet.js');

function env(name) {
  const m = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(
    new RegExp(`^${name}=(.+)$`, 'm'),
  );
  return m ? m[1] : undefined;
}

let failures = 0;
function check(okay, name, detail = '') {
  console.log(`${okay ? '  ok ' : 'MISS '} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!okay) failures++;
}

console.log('molt demo preflight\n');

// --- web app / TA -----------------------------------------------------------
// The authority that actually matters is the one agents talk to, which is
// MOLT_API_URL - not this machine's dev server. Checking localhost here
// produced a false alarm on a setup that runs entirely against the hosted
// beta.
const base = process.env.MOLT_TA_URL ?? env('MOLT_API_URL') ?? 'http://localhost:3000';
try {
  const health = await (
    await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(5000) })
  ).json();
  check(
    health.ok === true && health.mode === 'test',
    `Tab Authority up at ${base}`,
    `mode=${health.mode}`,
  );
} catch {
  check(false, `Tab Authority up at ${base}`, 'not reachable - pnpm --filter @molt/web dev');
}

// --- builds ------------------------------------------------------------------
check(existsSync('apps/mcp-server/dist/index.js'), 'MCP server built', 'pnpm build if missing');
check(existsSync('apps/demo-seller/dist/index.js'), 'demo seller built');
check(existsSync('packages/adapters/dist/index.js'), 'adapters built');

// --- config ------------------------------------------------------------------
check(Boolean(env('MOLT_DEMO_EMAIL')), 'MOLT_DEMO_EMAIL set (demo:reset target)');
check(Boolean(env('MOLT_WALLET_PASSPHRASE')), 'MOLT_WALLET_PASSPHRASE set');
check(Boolean(env('DEMO_SELLER_PAY_TO_ADDRESS')), 'DEMO_SELLER_PAY_TO_ADDRESS set');

// --- wallets -----------------------------------------------------------------
const walletPath = env('MOLT_WALLET_PATH') || join(homedir(), '.molt', 'wallet.json');
check(existsSync(walletPath), 'agent wallet keystore exists', walletPath);
const buyerPath = env('MOLT_BUYER_WALLET_PATH');
check(Boolean(buyerPath && existsSync(buyerPath)), 'buyer wallet keystore exists');
for (const [label, addr] of [
  ['agent', env('MOLT_AGENT_WALLET_ADDRESS')],
  ['buyer', env('DEMO_BUYER_ADDRESS')],
]) {
  if (!addr) {
    check(false, `${label} wallet address in .env`);
    continue;
  }
  try {
    const bal = await usdcBalance(addr);
    check(
      bal >= 1_000_000n,
      `${label} wallet funded`,
      `${(Number(bal) / 1e6).toFixed(2)} USDC on Base Sepolia`,
    );
  } catch {
    check(false, `${label} wallet balance readable`, 'RPC unreachable?');
  }
}

// --- dev stores --------------------------------------------------------------
const stores = (env('MOLT_TEST_SHOPIFY_STORES') ?? '').split(',').filter(Boolean);
check(stores.length >= 2, 'two dev stores configured');
for (const entry of stores) {
  const [url] = entry.trim().split('|');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'manual' });
    // password-protected stores 302 to /password; that means alive
    check(
      [200, 301, 302].includes(res.status),
      `store reachable: ${new URL(url).hostname}`,
      `HTTP ${res.status}`,
    );
  } catch {
    check(false, `store reachable: ${new URL(url).hostname}`);
  }
}

// --- demo account state ------------------------------------------------------
const demoEmail = env('MOLT_DEMO_EMAIL');
if (demoEmail && env('DATABASE_URL')) {
  const { createRequire } = await import('node:module');
  const postgres = createRequire(new URL('../apps/web/package.json', import.meta.url))('postgres');
  const sql = postgres(env('DATABASE_URL'), { prepare: false, max: 1 });
  try {
    const [user] = await sql`select id from users where email = ${demoEmail}`;
    if (!user) {
      check(false, 'demo account exists', `${demoEmail} not registered yet`);
    } else {
      const [tabs] = await sql`select count(*)::int as n from tabs where user_id = ${user.id}`;
      check(true, 'demo account exists', `${tabs.n} tab(s) - run pnpm demo:reset before the take`);
    }
  } finally {
    await sql.end();
  }
}

console.log(
  failures === 0 ? '\nall green - roll.' : `\n${failures} item(s) need attention before filming.`,
);
process.exitCode = failures === 0 ? 0 : 1;
