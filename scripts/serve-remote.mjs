/**
 * One command to expose the MCP server to a cloud client (Claude Cowork,
 * claude.ai connectors): `pnpm serve:remote`
 *
 * Reads .env, mints a token, starts the Streamable HTTP transport, opens a
 * cloudflared tunnel, waits for the public URL, and prints exactly what to
 * paste into the connector settings. Ctrl+C tears everything down, which
 * makes the URL worthless again.
 *
 * The server stays on this machine on purpose: it drives real browsers and
 * the wallet keys never leave it. Only the MCP port is published.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3940);

function env(name) {
  const m = readFileSync(join(ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
  return m ? m[1] : undefined;
}

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// --- what the server needs --------------------------------------------------
// Deliberately no agent key here: the human pastes it into the chat and the
// agent calls connect_tab, exactly like a local host. Setup stays credential-free.
if (!existsSync(join(ROOT, 'apps/mcp-server/dist/index.js'))) {
  die('The MCP server is not built yet. Run: pnpm build');
}

const stores = (env('MOLT_TEST_SHOPIFY_STORES') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [url, password] = s.split('|');
    return { host: new URL(url).hostname, password };
  });

const shipping = {
  email: env('MOLT_DEMO_EMAIL') ?? 'demo@example.com',
  first_name: 'Molt',
  last_name: 'Demo',
  address1: 'Teststr. 1',
  city: 'Munich',
  zip: '80331',
  country_code: 'DE',
  phone: '+4915212345678',
};

const token = process.env.MOLT_REMOTE_TOKEN ?? randomBytes(24).toString('hex');

// --- the server -------------------------------------------------------------
const server = spawn('node', ['apps/mcp-server/dist/index.js', '--http', String(PORT)], {
  cwd: ROOT,
  env: {
    ...process.env,
    MOLT_REMOTE_TOKEN: token,
    MOLT_API_URL: process.env.MOLT_API_URL ?? env('MOLT_PUBLIC_URL') ?? 'http://localhost:3000',
    MOLT_SHIPPING_PROFILE: JSON.stringify(shipping),
    MOLT_STOREFRONT_PASSWORDS: stores.map((s) => `${s.host}|${s.password}`).join(','),
    MOLT_BOGUS_GATEWAY_HOSTS: stores.map((s) => s.host).join(','),
    ...(env('MOLT_WALLET_PASSPHRASE')
      ? { MOLT_WALLET_PASSPHRASE: env('MOLT_WALLET_PASSPHRASE') }
      : {}),
  },
  stdio: ['ignore', 'inherit', 'pipe'],
});
server.stderr.on('data', (c) => process.stderr.write(`  [server] ${c}`));
server.on('exit', (code) => {
  if (code !== 0 && code !== null) die(`the MCP server exited with code ${code}`);
});

// --- the tunnel --------------------------------------------------------------
console.log('starting the tunnel...\n');
const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
tunnel.on('error', () =>
  die(
    'cloudflared is not installed. Run: brew install cloudflared  (or use ngrok http ' + PORT + ')',
  ),
);

let announced = false;
const watchForUrl = (chunk) => {
  const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!match || announced) return;
  announced = true;
  // Claude Cowork's connector dialog has no header field, so the token
  // rides in the path; hosts that can set headers may use /mcp instead.
  const url = `${match[0]}/mcp/${token}`;
  console.log(`
========================================================================
  Paste these into the connector settings
  (Cowork: Customize -> Connectors -> + )
========================================================================

  Name    Molt

  URL     ${url}

  (that URL carries the token - no header needed. Hosts that support
   headers can use ${match[0]}/mcp with: Authorization: Bearer ${token})

========================================================================
  Then, in the chat:
    1. "Which Molt tools do you have?"
       Expect: open_tab, connect_tab, resolve_merchant, purchase, get_receipts
    2. Paste your agent key (dashboard -> tab detail -> Agent key) and say
       "connect to my tab with this key". The agent calls connect_tab and
       is ready to buy - no restart, nothing to edit here.

  Ctrl+C stops both the tunnel and the server, which makes this URL
  worthless again. Treat it as a credential until then: whoever holds
  the URL and token can spend this tab, within its limits.
========================================================================
`);
};
tunnel.stdout.on('data', watchForUrl);
tunnel.stderr.on('data', watchForUrl); // cloudflared prints the URL on stderr

const shutdown = () => {
  tunnel.kill();
  server.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
