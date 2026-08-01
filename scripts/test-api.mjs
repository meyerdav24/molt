/**
 * OT-025 integration tests. Requires the web app running (pnpm dev) and
 * DATABASE_URL in .env. Seeds its own user/tab/root mandate/agent key,
 * exercises every /v1 endpoint, and cleans up after itself.
 *
 * Run from the repo root: node scripts/test-api.mjs
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// resolve the postgres client through apps/web's dependencies
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const postgres = require('postgres');

const BASE = process.env.MOLT_TA_URL ?? 'http://localhost:3000';

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
  }
}

async function api(method, path, { key, body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const userId = randomUUID();
const tabId = randomUUID();
const rootId = randomUUID();
const secret = `molt_sk_test_${randomBytes(24).toString('hex')}`;
const keyHash = createHash('sha256').update(secret).digest('hex');
const CART = 'a'.repeat(64);
const KNOWN = 'https://known-store.test.invalid';

async function seed() {
  const bounds = {
    amount_minor: 40000,
    currency: 'EUR',
    per_tx_max_minor: 15000,
    expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    mcc_allowlist: ['5943', '5732'],
    velocity_per_hour: 10,
    merchant_scope: '*',
  };
  const policy = {
    unknown_merchant: 'require_tap',
    amount_above_baseline: 'allow',
    mcc_outside_allowlist: 'block',
    velocity_exceeded: 'block',
  };
  await sql`insert into users (id, email) values (${userId}, ${`api-test-${userId}@test.invalid`})`;
  await sql`insert into tabs (id, user_id, total_minor, remaining_minor, expires_at)
            values (${tabId}, ${userId}, 40000, 40000, ${bounds.expires_at})`;
  await sql`insert into mandates (id, tab_id, kind, status, bounds, amount_minor, currency,
              merchant_scope, task_declaration, step_up_policy, webauthn_assertion, challenge_hash, expires_at)
            values (${rootId}, ${tabId}, 'root', 'active', ${sql.json(bounds)}, 40000, 'EUR', '*',
              'integration test', ${sql.json(policy)}, '{}', ${'0'.repeat(64)}, ${bounds.expires_at})`;
  await sql`insert into agent_keys (tab_id, user_id, key_hash, key_prefix)
            values (${tabId}, ${userId}, ${keyHash}, ${secret.slice(0, 19)})`;
  // one prior receipt so KNOWN counts as a known merchant
  await sql`insert into receipts (tab_id, mandate_id, rung, rail, merchant, amount_minor, currency,
              idempotency_key, mandate_chain)
            values (${tabId}, ${rootId}, 'L1', 'card_stripe_test', ${KNOWN}, 1200, 'EUR',
              ${`seed-${tabId}`}, ${sql.json([rootId])})`;
}

async function cleanup() {
  await sql`delete from users where id = ${userId}`;
  await sql.end();
}

try {
  await seed();

  // ceremony URL, no auth
  const t0 = await api('POST', '/v1/tabs');
  ok(
    t0.status === 200 && t0.body.ceremony_url?.endsWith('/tabs/new'),
    'POST /v1/tabs returns ceremony url',
  );

  // auth gates
  ok((await api('GET', `/v1/tabs/${tabId}`)).status === 401, 'GET tab without key -> 401');
  ok(
    (await api('GET', `/v1/tabs/${tabId}`, { key: 'molt_sk_test_wrong' })).status === 401,
    'GET tab with wrong key -> 401',
  );

  const tab = await api('GET', `/v1/tabs/${tabId}`, { key: secret });
  ok(
    tab.status === 200 && tab.body.remaining_minor === 40000 && tab.body.per_tx_max_minor === 15000,
    'GET tab returns bounds + budget',
  );

  // known merchant, small amount -> active
  const m1 = await api('POST', `/v1/tabs/${tabId}/mandates`, {
    key: secret,
    body: {
      merchant_origin: KNOWN,
      amount_minor: 3400,
      cart_hash: CART,
      reason: 'restock',
      mcc: '5732',
    },
  });
  ok(m1.status === 201 && m1.body.status === 'active', 'known merchant mints active mandate');

  // budget decremented
  const tab2 = await api('GET', `/v1/tabs/${tabId}`, { key: secret });
  ok(tab2.body.remaining_minor === 40000 - 3400, 'budget decremented by mint');

  // unknown merchant -> held (require_tap)
  const m2 = await api('POST', `/v1/tabs/${tabId}/mandates`, {
    key: secret,
    body: {
      merchant_origin: 'https://new-store.test.invalid',
      amount_minor: 1000,
      cart_hash: 'b'.repeat(64),
      reason: 'restock',
    },
  });
  ok(m2.status === 202 && m2.body.status === 'held', 'unknown merchant is held for tap');

  // held mandate is visible via polling endpoint
  const poll = await api('GET', `/v1/mandates/${m2.body.mandate_id}`, { key: secret });
  ok(poll.status === 200 && poll.body.status === 'held', 'GET mandate shows held status');

  // held mandate is unusable: receipt filing must fail
  const heldReceipt = await api('POST', `/v1/mandates/${m2.body.mandate_id}/receipt`, {
    key: secret,
    body: {
      rung: 'L1',
      rail: 'card_stripe_test',
      merchant: 'https://new-store.test.invalid',
      amount_minor: 1000,
      currency: 'EUR',
      idempotency_key: `held-${tabId}`,
    },
  });
  ok(heldReceipt.status === 409, 'held mandate cannot file a receipt');

  // MCC outside allowlist -> blocked by policy
  const m3 = await api('POST', `/v1/tabs/${tabId}/mandates`, {
    key: secret,
    body: {
      merchant_origin: KNOWN,
      amount_minor: 1000,
      cart_hash: 'c'.repeat(64),
      reason: 'x',
      mcc: '7995',
    },
  });
  ok(
    m3.status === 403 && m3.body.error === 'blocked_by_policy',
    'MCC outside allowlist -> 403 with triggers',
  );

  // narrowing violation -> 422 (amount above per-tx max; policy allows first)
  const m4 = await api('POST', `/v1/tabs/${tabId}/mandates`, {
    key: secret,
    body: {
      merchant_origin: KNOWN,
      amount_minor: 15001,
      cart_hash: 'd'.repeat(64),
      reason: 'x',
      mcc: '5732',
    },
  });
  ok(
    m4.status === 422 && m4.body.violations?.some((v) => v.code === 'amount_exceeds_per_tx_max'),
    'over per-tx max -> 422 narrowing violation',
  );

  // receipt for the active mandate
  const r1 = await api('POST', `/v1/mandates/${m1.body.mandate_id}/receipt`, {
    key: secret,
    body: {
      rung: 'L1',
      rail: 'card_stripe_test',
      merchant: KNOWN,
      amount_minor: 3400,
      currency: 'EUR',
      idempotency_key: `it-${tabId}`,
      evidence: { dom_sha256: 'e'.repeat(64) },
    },
  });
  ok(r1.status === 201, 'receipt filed for active mandate');

  // duplicate idempotency key
  const r2 = await api('POST', `/v1/mandates/${m1.body.mandate_id}/receipt`, {
    key: secret,
    body: {
      rung: 'L1',
      rail: 'card_stripe_test',
      merchant: KNOWN,
      amount_minor: 3400,
      currency: 'EUR',
      idempotency_key: `it-${tabId}`,
    },
  });
  ok(r2.status === 409, 'consumed mandate / duplicate key -> 409');

  // receipts list
  const list = await api('GET', `/v1/tabs/${tabId}/receipts`, { key: secret });
  ok(
    list.status === 200 && list.body.receipts.length === 2,
    'receipts list returns filed receipts',
  );

  // key revocation
  await sql`update agent_keys set status = 'revoked' where key_hash = ${keyHash}`;
  ok((await api('GET', `/v1/tabs/${tabId}`, { key: secret })).status === 401, 'revoked key -> 401');

  // policy decisions visible in event log
  const events = await sql`select type from events where tab_id = ${tabId}`;
  const types = events.map((e) => e.type);
  ok(
    types.includes('policy.decision') &&
      types.includes('mandate.held') &&
      types.includes('receipt.filed'),
    'decisions and receipts in audit log',
  );

  console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}`);
} finally {
  await cleanup();
}
