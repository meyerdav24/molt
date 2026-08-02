/**
 * OT-070/098 smoke test: seeds a tab with a full molt cycle (grown, worn,
 * shed) plus a held request, then checks the real HTTP surfaces with a
 * signed session cookie:
 *
 *   - tab detail renders shell counter, mandate tree, receipts, lifecycle log
 *   - the receipt JSON download round-trips: the document reconstructed from
 *     the DB still verifies offline (both signatures)
 *   - another user's tab 404s
 *   - a held mint records items_summary for the step-up page
 *
 * Requires the web app running. Run from the repo root:
 *   node scripts/test-dashboard.mjs
 */
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const postgres = webRequire('postgres');
const { SignJWT } = webRequire('jose');
const { signReceiptAsAgent, countersignReceiptAsTa, verifyReceipt } =
  await import('../packages/protocol/dist/index.js');

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
    console.log(`ok: ${name}`);
  }
}

// --- seed: one tab, one worn shell (receipt), one shed-unworn, one held ----
const userId = randomUUID();
const otherUserId = randomUUID();
const tabId = randomUUID();
const otherTabId = randomUUID();
const rootId = randomUUID();
const wornId = randomUUID();
const shedId = randomUUID();
const receiptId = randomUUID();
const secret = `molt_sk_test_${randomBytes(24).toString('hex')}`;
const MERCHANT = 'https://brightside-office-supply.myshopify.com';

const agentPair = generateKeyPairSync('ed25519');
const AGENT_PRIV = agentPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const AGENT_PUB = agentPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const TA_PRIV = Buffer.from(env('MOLT_TA_SIGNING_KEY'), 'base64').toString('utf8');

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

async function seed() {
  const policy = {
    unknown_merchant: 'require_tap',
    amount_above_baseline: 'allow',
    mcc_outside_allowlist: 'block',
    velocity_exceeded: 'block',
  };
  await sql`insert into users (id, email) values
    (${userId}, ${`dash-${userId}@test.invalid`}),
    (${otherUserId}, ${`dash-other-${userId}@test.invalid`})`;
  await sql`insert into tabs (id, user_id, total_minor, remaining_minor, expires_at) values
    (${tabId}, ${userId}, 40000, 36600, ${expires}),
    (${otherTabId}, ${otherUserId}, 10000, 10000, ${expires})`;
  await sql`insert into mandates (id, tab_id, kind, status, bounds, amount_minor, currency,
              merchant_scope, task_declaration, step_up_policy, webauthn_assertion, challenge_hash, expires_at)
            values (${rootId}, ${tabId}, 'root', 'active', ${sql.json(bounds)}, 40000, 'EUR', '*',
              'restock the office: paper, towels, a USB hub',
              ${sql.json(policy)}, '{}', ${'0'.repeat(64)}, ${expires})`;
  await sql`insert into mandates (id, tab_id, parent_id, kind, status, bounds, amount_minor, currency,
              merchant_scope, cart_hash, reason, expires_at)
            values
            (${wornId}, ${tabId}, ${rootId}, 'child', 'consumed', ${sql.json({ ...bounds, amount_minor: 3400, merchant_scope: MERCHANT })},
             3400, 'EUR', ${MERCHANT}, ${'a'.repeat(64)}, 'USB-C hub for the office', ${expires}),
            (${shedId}, ${tabId}, ${rootId}, 'child', 'revoked', ${sql.json({ ...bounds, amount_minor: 1200, merchant_scope: MERCHANT })},
             1200, 'EUR', ${MERCHANT}, ${'b'.repeat(64)}, 'paper towels, aborted', ${expires})`;
  await sql`insert into agent_keys (tab_id, user_id, key_hash, key_prefix)
            values (${tabId}, ${userId}, ${createHash('sha256').update(secret).digest('hex')},
                    ${secret.slice(0, 19)})`;

  // dual-signed receipt, inserted exactly as the filing route would
  const body = {
    id: receiptId,
    tab_id: tabId,
    mandate_id: wornId,
    rung: 'L1',
    rail: 'card_stripe_test',
    merchant: MERCHANT,
    amount_minor: 3400,
    currency: 'EUR',
    evidence: { dom_sha256: 'e'.repeat(64), screenshot_sha256: 'f'.repeat(64) },
    idempotency_key: `dash-${tabId}`,
    mandate_chain: [rootId, wornId],
    created_at: new Date().toISOString(),
  };
  const agentSig = signReceiptAsAgent(body, AGENT_PRIV);
  const taSig = countersignReceiptAsTa(body, agentSig, TA_PRIV);
  const { createPublicKey, createPrivateKey } = await import('node:crypto');
  const taPub = createPublicKey(createPrivateKey(TA_PRIV))
    .export({ type: 'spki', format: 'pem' })
    .toString();
  await sql`insert into receipts
      (id, tab_id, mandate_id, rung, rail, merchant, amount_minor, currency, evidence,
       idempotency_key, mandate_chain, agent_signature, ta_signature,
       agent_public_key, ta_public_key, created_at)
    values
      (${body.id}, ${tabId}, ${wornId}, 'L1', 'card_stripe_test', ${MERCHANT}, 3400, 'EUR',
       ${sql.json(body.evidence)}, ${body.idempotency_key}, ${sql.json(body.mandate_chain)},
       ${agentSig}, ${taSig}, ${AGENT_PUB}, ${taPub}, ${body.created_at})`;

  await sql`insert into events (tab_id, mandate_id, user_id, actor, type, payload) values
    (${tabId}, ${wornId}, ${userId}, 'ta', 'mandate.activated', ${sql.json({})}),
    (${tabId}, ${wornId}, ${userId}, 'agent', 'receipt.filed', ${sql.json({ receipt_id: receiptId })}),
    (${tabId}, ${shedId}, ${userId}, 'agent', 'mandate.canceled', ${sql.json({ refunded_minor: 1200 })})`;
}

async function cleanup() {
  await sql`delete from users where id in (${userId}, ${otherUserId})`;
  await sql.end();
}

async function sessionCookie(uid) {
  const token = await new SignJWT({ sub: uid, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(env('MOLT_SESSION_SECRET')));
  return `molt_session=${token}`;
}

await seed();
try {
  const cookie = await sessionCookie(userId);

  // --- tab detail page -------------------------------------------------------
  const page = await fetch(`${BASE}/dashboard/tabs/${tabId}`, { headers: { cookie } });
  const html = await page.text();
  ok(page.status === 200, 'tab detail renders (200)');
  ok(/shells:/.test(html) && /grown/.test(html) && /shed/.test(html), 'shell counter present');
  ok(html.includes('2</strong> grown'), 'counter: 2 grown');
  ok(html.includes('1</strong> worn'), 'counter: 1 worn');
  ok(html.includes('2</strong> shed'), 'counter: 2 shed (worn + unworn)');
  ok(
    html.includes(wornId.slice(0, 8)) && html.includes(shedId.slice(0, 8)),
    'mandate tree lists children',
  );
  ok(
    html.includes('shell worn once') && html.includes('shell shed (unworn)'),
    'lifecycle wording in event log',
  );
  ok(html.includes('restock the office'), 'task declaration shown');
  ok(html.includes(secret.slice(0, 19)), 'agent key prefix listed');
  ok(html.includes('dual-signed'), 'receipt row marked dual-signed');

  // --- receipt download round-trip -------------------------------------------
  const dl = await fetch(`${BASE}/api/tabs/${tabId}/receipts/${receiptId}`, {
    headers: { cookie },
  });
  ok(dl.status === 200, 'receipt JSON downloads (200)');
  const doc = await dl.json();
  const verdict = verifyReceipt(doc, {
    agent_public_key: doc.agent_public_key,
    ta_public_key: doc.ta_public_key,
  });
  ok(verdict.valid, 'downloaded receipt verifies offline (DB round-trip)');

  // --- isolation ---------------------------------------------------------------
  const foreign = await fetch(`${BASE}/dashboard/tabs/${otherTabId}`, { headers: { cookie } });
  ok(foreign.status === 404, "another user's tab is a 404");
  const anon = await fetch(`${BASE}/api/tabs/${tabId}/receipts/${receiptId}`);
  ok(anon.status === 401, 'receipt download needs a session');

  // --- held mint records items_summary for the step-up page --------------------
  const mint = await fetch(`${BASE}/api/v1/tabs/${tabId}/mandates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      merchant_origin: 'https://never-seen-before.test.invalid',
      amount_minor: 900,
      cart_hash: 'c'.repeat(64),
      reason: 'held path test',
      items_summary: ['1× Espresso Machine Pro', '2× Descaler'],
    }),
  });
  ok(mint.status === 202, 'unknown merchant is held for the tap');
  const held = await mint.json();
  const [heldEvent] = await sql`
    select payload from events
    where mandate_id = ${held.mandate_id} and type = 'mandate.held'
    order by id desc limit 1`;
  ok(
    JSON.stringify(heldEvent?.payload?.items_summary) ===
      JSON.stringify(['1× Espresso Machine Pro', '2× Descaler']),
    'held event carries items_summary for the step-up page',
  );

  // --- GDPR deletion (OT-082): the cascade that actually cascades -------------
  const eventIds = (await sql`select id from events where user_id = ${userId}`).map((r) => r.id);
  ok(eventIds.length > 0, 'events exist before deletion');

  const noConfirm = await fetch(`${BASE}/api/auth/delete`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'yes' }),
  });
  ok(noConfirm.status === 400, 'deletion without the verbatim confirmation is refused');

  const del = await fetch(`${BASE}/api/auth/delete`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'delete my account and all its data' }),
  });
  ok(del.status === 200, 'deletion with confirmation succeeds');

  const [gone] = await sql`select count(*)::int as n from users where id = ${userId}`;
  const [tabsGone] = await sql`select count(*)::int as n from tabs where user_id = ${userId}`;
  const [receiptsGone] = await sql`select count(*)::int as n from receipts where id = ${receiptId}`;
  ok(gone.n === 0 && tabsGone.n === 0 && receiptsGone.n === 0, 'user, tabs, receipts are gone');

  const anonymized = await sql`
    select count(*)::int as n from events
    where id = any(${eventIds}) and user_id is null and tab_id is null`;
  ok(
    anonymized[0].n === eventIds.length,
    'event rows remain, anonymized (audit trail without a name)',
  );

  const [other] = await sql`select count(*)::int as n from users where id = ${otherUserId}`;
  ok(other.n === 1, "the other user's account is untouched");
} finally {
  await cleanup();
}

console.log(`\n${passed} assertions passed`);
