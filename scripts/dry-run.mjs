/**
 * One cold end-to-end dry run (OT-100): the full loop a real user walks,
 * with the two passkey-only moments (ceremony, approve tap) replaced by
 * their seeded equivalents - those stay on the human device-test list.
 *
 *   pnpm demo:reset -> fresh tab -> agent purchase (quote, mandate, card,
 *   checkout, dual-signed receipt) -> `molt verify` on the receipt file ->
 *   dashboard shows the molt cycle -> held purchase at an unknown merchant
 *   -> deny via the step-up link -> budget refunded -> receipts listed.
 *
 * Prints stage timings (the papercut log) and a one-line shape summary so
 * consecutive runs can be compared (OT-095 AC). Run from the repo root:
 *
 *   node scripts/dry-run.mjs [run-label]
 */
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const postgres = webRequire('postgres');
const { SignJWT } = webRequire('jose');
const mcpRequire = createRequire(new URL('../apps/mcp-server/package.json', import.meta.url));
const { Client } = await import(mcpRequire.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StdioClientTransport } = await import(
  mcpRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js')
);
const { signReceiptAsAgent, countersignReceiptAsTa } =
  await import('../packages/protocol/dist/index.js');

const BASE = process.env.MOLT_TA_URL ?? 'http://localhost:3000';
const LABEL = process.argv[2] ?? 'dry';
const DRY_EMAIL = 'dry-run@molt.test.invalid';

function env(name) {
  const m = readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`${name} not in .env`);
  return m[1];
}

const sql = postgres(env('DATABASE_URL'), { prepare: false, max: 2 });

let passed = 0;
const shape = [];
function ok(cond, name) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    passed++;
  }
}
const t0 = Date.now();
let tLast = t0;
function stage(name) {
  const now = Date.now();
  console.log(`  [${LABEL}] ${name}: ${((now - tLast) / 1000).toFixed(1)}s`);
  tLast = now;
}

// --- 0. reset: yesterday's take disappears ----------------------------------
execFileSync('node', ['demo/reset.mjs', '--email', DRY_EMAIL], { stdio: 'pipe' });
stage('reset');

// --- 1. fresh tab (ceremony equivalent; the passkey moment is a human test) --
const tabId = randomUUID();
const rootId = randomUUID();
const knownId = randomUUID();
const secret = `molt_sk_test_${randomBytes(24).toString('hex')}`;
const stores = env('MOLT_TEST_SHOPIFY_STORES')
  .split(',')
  .map((s) => s.trim().split('|'));
const [brightUrl, brightPw] = stores[0];
const [harborUrl, harborPw] = stores[1];
const brightHost = new URL(brightUrl).hostname;
const harborHost = new URL(harborUrl).hostname;

const expires = new Date(Date.now() + 24 * 3600_000).toISOString();
const bounds = {
  amount_minor: 40000,
  currency: 'EUR',
  per_tx_max_minor: 15000,
  expires_at: expires,
  mcc_allowlist: [],
  velocity_per_hour: 10,
  merchant_scope: '*',
};
const policy = {
  unknown_merchant: 'require_tap',
  amount_above_baseline: 'allow',
  mcc_outside_allowlist: 'block',
  velocity_exceeded: 'block',
};

let [user] = await sql`select id from users where email = ${DRY_EMAIL}`;
if (!user) {
  [user] = await sql`insert into users (id, email) values (${randomUUID()}, ${DRY_EMAIL})
                     returning id`;
}
await sql`insert into tabs (id, user_id, total_minor, remaining_minor, expires_at)
          values (${tabId}, ${user.id}, 40000, 36600, ${expires})`;
await sql`insert into mandates (id, tab_id, kind, status, bounds, amount_minor, currency,
            merchant_scope, task_declaration, step_up_policy, webauthn_assertion, challenge_hash, expires_at)
          values (${rootId}, ${tabId}, 'root', 'active', ${sql.json(bounds)}, 40000, 'EUR', '*',
            'restock the office: paper, towels, a USB hub',
            ${sql.json(policy)}, '{}', ${'0'.repeat(64)}, ${expires})`;
await sql`insert into agent_keys (tab_id, user_id, key_hash, key_prefix)
          values (${tabId}, ${user.id}, ${createHash('sha256').update(secret).digest('hex')},
                  ${secret.slice(0, 19)})`;

// one prior brightside receipt: the store the task names is a known merchant.
// (Papercut for the demo take: on a truly clean tab EVERY merchant is unknown
// and the very first purchase gets held - seed history or film the tap first.)
const agentPair = generateKeyPairSync('ed25519');
const APRIV = agentPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const TA_PRIV = Buffer.from(env('MOLT_TA_SIGNING_KEY'), 'base64').toString('utf8');
await sql`insert into mandates (id, tab_id, parent_id, kind, status, bounds, amount_minor, currency,
            merchant_scope, cart_hash, reason, expires_at)
          values (${knownId}, ${tabId}, ${rootId}, 'child', 'consumed',
            ${sql.json({ ...bounds, amount_minor: 3400, merchant_scope: brightUrl })},
            3400, 'EUR', ${brightUrl}, ${'a'.repeat(64)}, 'prior office order', ${expires})`;
{
  const body = {
    id: randomUUID(),
    tab_id: tabId,
    mandate_id: knownId,
    rung: 'L1',
    rail: 'card_stripe_test',
    merchant: brightUrl,
    amount_minor: 3400,
    currency: 'EUR',
    evidence: { dom_sha256: 'e'.repeat(64) },
    idempotency_key: `dry-prior-${tabId}`,
    mandate_chain: [rootId, knownId],
    created_at: new Date().toISOString(),
  };
  const asig = signReceiptAsAgent(body, APRIV);
  await sql`insert into receipts (id, tab_id, mandate_id, rung, rail, merchant, amount_minor,
      currency, evidence, idempotency_key, mandate_chain, agent_signature, ta_signature)
    values (${body.id}, ${tabId}, ${knownId}, 'L1', 'card_stripe_test', ${brightUrl}, 3400, 'EUR',
      ${sql.json(body.evidence)}, ${body.idempotency_key}, ${sql.json(body.mandate_chain)},
      ${asig}, ${countersignReceiptAsTa(body, asig, TA_PRIV)})`;
}
stage('seed tab');

// --- 2. the agent, over MCP --------------------------------------------------
const scratch = process.env.EVIDENCE_DIR ?? join(tmpdir(), `molt-dry-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['apps/mcp-server/dist/index.js'],
  env: {
    ...process.env,
    MOLT_API_URL: BASE,
    MOLT_AGENT_KEY: secret,
    MOLT_EVIDENCE_DIR: scratch,
    MOLT_AGENT_SIGNING_KEY_PATH: join(scratch, 'agent-signing-key.pem'),
    MOLT_STOREFRONT_PASSWORDS: `${brightHost}|${brightPw},${harborHost}|${harborPw}`,
    MOLT_BOGUS_GATEWAY_HOSTS: `${brightHost},${harborHost}`,
    MOLT_SHIPPING_PROFILE: JSON.stringify({
      email: 'david.meyer.student@gmail.com',
      first_name: 'Molt',
      last_name: 'Demo',
      address1: 'Teststr. 1',
      city: 'Munich',
      zip: '80331',
      country_code: 'DE',
      phone: '+4915212345678',
    }),
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'dry-run', version: '0.0.1' });
const call = async (name, args) =>
  JSON.parse(
    (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })).content[0]
      .text,
  );

try {
  await client.connect(transport);

  // purchase at the known store: the full molt cycle
  const bought = await call('purchase', {
    tab_id: tabId,
    merchant_url: brightUrl,
    items: [{ variant_id: 50283551555823, quantity: 1 }],
    max_amount_minor: 3400,
    reason: 'dry run: USB-C hub for the office restock',
  });
  if (bought.status !== 'purchased') console.error('outcome:', JSON.stringify(bought, null, 2));
  ok(bought.status === 'purchased', 'purchase completes');
  shape.push(`purchase=${bought.status}`);
  stage('purchase (quote+mandate+card+checkout+receipt)');

  // the receipt file verifies offline via the actual CLI
  if (bought.receipt) {
    const receiptPath = join(scratch, 'receipt.json');
    writeFileSync(receiptPath, JSON.stringify(bought.receipt, null, 2));
    let verifyOut = '';
    try {
      verifyOut = execFileSync('node', ['packages/protocol/dist/cli.js', 'verify', receiptPath], {
        encoding: 'utf8',
      });
    } catch (e) {
      verifyOut = String(e.stdout ?? e.message);
    }
    ok(/valid/i.test(verifyOut) && !/invalid/i.test(verifyOut), 'molt verify accepts the receipt');
    shape.push('verify=valid');
    stage('molt verify');
  } else {
    ok(false, 'no receipt to verify (purchase did not complete)');
    shape.push('verify=skipped');
  }

  // the dashboard carries the molt cycle (session-cookie render check)
  const cookie = `molt_session=${await new SignJWT({ sub: user.id, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(env('MOLT_SESSION_SECRET')))}`;
  const html = await (
    await fetch(`${BASE}/dashboard/tabs/${tabId}`, { headers: { cookie } })
  ).text();
  ok(/shells:/.test(html) && /worn/.test(html), 'dashboard shows the shell counter');
  ok(html.includes('shell worn once'), 'event log speaks the lifecycle');
  stage('dashboard');

  // unknown merchant -> held for the tap -> deny (the scripted user action)
  const held = await call('purchase', {
    tab_id: tabId,
    merchant_url: harborUrl,
    items: [{ variant_id: 54518565372179, quantity: 1 }],
    max_amount_minor: 900,
    reason: 'dry run: HDMI cable from an unknown store',
  });
  if (held.status !== 'step_up_pending') console.error('outcome:', JSON.stringify(held, null, 2));
  ok(held.status === 'step_up_pending', 'unknown merchant is held, no shell grown');
  shape.push(`stepup=${held.status}`);
  stage('held purchase (quote+hold)');

  const [before] = await sql`select remaining_minor from tabs where id = ${tabId}`;
  const token = await new SignJWT({ typ: 'stepup', mandate_id: held.mandate_id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(env('MOLT_SESSION_SECRET')));
  const deny = await fetch(`${BASE}/api/step-up/deny`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  ok(deny.status === 200, 'deny is one tap');
  const [after] = await sql`select remaining_minor from tabs where id = ${tabId}`;
  ok(
    Number(after.remaining_minor) === Number(before.remaining_minor) + 900,
    'denied hold refunds the budget',
  );
  shape.push('deny=refunded');
  stage('deny + refund');

  // receipts: the prior one and the new one, nothing else
  const receipts = await call('get_receipts', { tab_id: tabId });
  ok(receipts.receipts?.length === 2, `receipts list has 2 entries`);
  shape.push(`receipts=${receipts.receipts?.length}`);
  stage('receipts');
} finally {
  await client.close().catch(() => {});
  await sql.end();
}

console.log(
  `[${LABEL}] ${passed} assertions, ${((Date.now() - t0) / 1000).toFixed(0)}s total | shape: ${shape.join(' ')}`,
);
