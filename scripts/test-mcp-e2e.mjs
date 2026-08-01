/**
 * OT-040 end-to-end test: drives the built MCP server over stdio exactly like
 * Claude Desktop would, against the running web app and a real dev store.
 *
 *   quote -> child mandate -> scoped card -> L1 checkout -> dual-signed receipt
 *
 * Requires: web app running (pnpm dev), DATABASE_URL + MOLT_TEST_SHOPIFY_STORES
 * in .env, packages built. Run from the repo root:
 *
 *   node scripts/test-mcp-e2e.mjs
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const postgres = webRequire('postgres');
const mcpRequire = createRequire(new URL('../apps/mcp-server/package.json', import.meta.url));
const { Client } = await import(
  mcpRequire.resolve('@modelcontextprotocol/sdk/client/index.js')
);
const { StdioClientTransport } = await import(
  mcpRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js')
);
const { verifyReceipt } = await import('../packages/protocol/dist/index.js');

function env(name) {
  const m = readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`${name} not in .env`);
  return m[1];
}

const sql = postgres(env('DATABASE_URL'), { prepare: false, max: 2 });

let passed = 0;
function ok(cond, name) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`ok: ${name}`);
  }
}

// --- seed a tab the agent may spend from -----------------------------------
const userId = randomUUID();
const tabId = randomUUID();
const rootId = randomUUID();
const secret = `molt_sk_test_${randomBytes(24).toString('hex')}`;

const [store] = env('MOLT_TEST_SHOPIFY_STORES').split(',');
const [storeUrl, storePassword] = store.trim().split('|');
const storeHost = new URL(storeUrl).hostname;
// brightside catalog item (see test-shopify-checkout.mjs): 34.00 EUR total
const VARIANT = 50283551555823;
const TOTAL = 3400;

async function seed() {
  const bounds = {
    amount_minor: 20000,
    currency: 'EUR',
    per_tx_max_minor: 10000,
    expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    mcc_allowlist: [],
    velocity_per_hour: 10,
    merchant_scope: '*',
  };
  const policy = {
    unknown_merchant: 'allow',
    amount_above_baseline: 'allow',
    mcc_outside_allowlist: 'block',
    velocity_exceeded: 'block',
  };
  await sql`insert into users (id, email) values (${userId}, ${`mcp-e2e-${userId}@test.invalid`})`;
  await sql`insert into tabs (id, user_id, total_minor, remaining_minor, expires_at)
            values (${tabId}, ${userId}, 20000, 20000, ${bounds.expires_at})`;
  await sql`insert into mandates (id, tab_id, kind, status, bounds, amount_minor, currency,
              merchant_scope, task_declaration, step_up_policy, webauthn_assertion, challenge_hash, expires_at)
            values (${rootId}, ${tabId}, 'root', 'active', ${sql.json(bounds)}, 20000, 'EUR', '*',
              'mcp e2e test: buy office supplies', ${sql.json(policy)}, '{}', ${'0'.repeat(64)}, ${bounds.expires_at})`;
  await sql`insert into agent_keys (tab_id, user_id, key_hash, key_prefix)
            values (${tabId}, ${userId}, ${createHash('sha256').update(secret).digest('hex')},
                    ${secret.slice(0, 19)})`;
}

async function cleanup() {
  await sql`delete from users where id = ${userId}`;
  await sql.end();
}

function parse(result) {
  return JSON.parse(result.content[0].text);
}

// two full browser passes + mint + receipt: give purchase real time
const SLOW = { timeout: 300_000 };
async function callTool(name, args, options) {
  return client.callTool({ name, arguments: args }, undefined, options);
}

await seed();

const scratch = process.env.EVIDENCE_DIR ?? join(tmpdir(), `molt-mcp-e2e-${Date.now()}`);
const transport = new StdioClientTransport({
  command: 'node',
  args: ['apps/mcp-server/dist/index.js'],
  env: {
    ...process.env,
    MOLT_API_URL: 'http://localhost:3000',
    MOLT_AGENT_KEY: secret,
    MOLT_EVIDENCE_DIR: scratch,
    MOLT_AGENT_SIGNING_KEY_PATH: join(scratch, 'agent-signing-key.pem'),
    MOLT_STOREFRONT_PASSWORDS: `${storeHost}|${storePassword}`,
    MOLT_BOGUS_GATEWAY_HOSTS: storeHost,
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
const client = new Client({ name: 'mcp-e2e-test', version: '0.0.1' });

try {
  await client.connect(transport);

  // the four tools, discoverable
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  ok(
    JSON.stringify(names) === JSON.stringify(['get_receipts', 'open_tab', 'purchase', 'resolve_merchant']),
    `four tools exposed (${names.join(', ')})`,
  );

  // open_tab returns the ceremony URL - the agent cannot self-authorize
  const opened = parse(await client.callTool({ name: 'open_tab', arguments: {} }));
  ok(
    typeof opened.ceremony_url === 'string' && opened.ceremony_url.includes('/tabs/new'),
    'open_tab returns the human ceremony URL',
  );

  // resolve_merchant classifies the dev store as shopify/L1
  const detection = parse(
    await client.callTool({ name: 'resolve_merchant', arguments: { url: storeUrl } }),
  );
  ok(
    detection.platform === 'shopify' && detection.recommended_rung === 'L1',
    `resolve_merchant: ${storeHost} -> shopify/L1`,
  );

  // the real thing: quote -> mandate -> card -> checkout -> receipt
  const args = {
    tab_id: tabId,
    merchant_url: storeUrl,
    items: [{ variant_id: VARIANT, quantity: 1 }],
    max_amount_minor: TOTAL,
    reason: 'buying office supplies for the mcp e2e test task',
  };
  const bought = parse(await callTool('purchase', args, SLOW));
  if (bought.status !== 'purchased') console.error('purchase outcome:', JSON.stringify(bought, null, 2));
  ok(bought.status === 'purchased', `purchase completed (status: ${bought.status})`);
  if (bought.status === 'purchased') {
    ok(/#|order|confirm/i.test(bought.order_confirmation), 'order confirmation captured');
    const verdict = verifyReceipt(bought.receipt, {
      agent_public_key: bought.receipt.agent_public_key,
      ta_public_key: bought.receipt.ta_public_key,
    });
    ok(verdict.valid, 'receipt verifies offline (agent + TA signatures)');
    ok(bought.receipt.rung === 'L1' && bought.receipt.amount_minor === TOTAL, 'receipt records rung + amount');
    ok(
      Array.isArray(bought.receipt.mandate_chain) && bought.receipt.mandate_chain[0] === rootId,
      'mandate chain starts at the root',
    );

    // the shell is shed: mandate consumed, card gone from active duty
    const [m] = await sql`select status from mandates where id = ${bought.receipt.mandate_id}`;
    ok(m?.status === 'consumed', 'child mandate is consumed after purchase');

    // same cart again: refuse the double order before anything is minted
    const again = parse(await callTool('purchase', args, SLOW));
    ok(again.status === 'already_purchased', `re-purchase refused (status: ${again.status})`);

    // receipts list shows it
    const list = parse(
      await client.callTool({ name: 'get_receipts', arguments: { tab_id: tabId } }),
    );
    ok(
      list.receipts?.some((r) => r.id === bought.receipt.id),
      'get_receipts lists the new receipt',
    );
  }

  // a quote above the ceiling refuses before minting
  const tooCheap = parse(
    await callTool(
      'purchase',
      { ...args, items: [{ variant_id: VARIANT, quantity: 2 }], max_amount_minor: 100 },
      SLOW,
    ),
  );
  if (tooCheap.status !== 'refused' || tooCheap.reason !== 'quote_exceeds_max_amount') {
    console.error('tooCheap outcome:', JSON.stringify(tooCheap, null, 2));
  }
  ok(
    tooCheap.status === 'refused' && tooCheap.reason === 'quote_exceeds_max_amount',
    'quote above max_amount refuses before any mandate exists',
  );
} finally {
  await client.close().catch(() => {});
  await cleanup();
}

console.log(`\n${passed} assertions passed`);
