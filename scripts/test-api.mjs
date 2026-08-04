/**
 * OT-025 integration tests. Requires the web app running (pnpm dev) and
 * DATABASE_URL in .env. Seeds its own user/tab/root mandate/agent key,
 * exercises every /v1 endpoint, and cleans up after itself.
 *
 * Run from the repo root: node scripts/test-api.mjs
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as cryptoModule from 'node:crypto';
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

// Receipt filing is dual-signed (OT-060): the script plays the agent side
// with its own ephemeral ed25519 key.
const { signReceiptAsAgent, verifyReceipt } = await import('../packages/protocol/dist/index.js');
const agentKeyPair = cryptoModule.generateKeyPairSync('ed25519');
const AGENT_PRIV = agentKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const AGENT_PUB = agentKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signedReceipt({ mandate_id, merchant, amount_minor, idempotency_key, evidence = {} }) {
  const receipt = {
    id: randomUUID(),
    tab_id: tabId,
    mandate_id,
    rung: 'L1',
    rail: 'card_stripe_test',
    merchant,
    amount_minor,
    currency: 'EUR',
    evidence,
    idempotency_key,
    mandate_chain: [rootId, mandate_id],
    created_at: new Date().toISOString(),
  };
  return {
    receipt,
    agent_signature: signReceiptAsAgent(receipt, AGENT_PRIV),
    agent_public_key: AGENT_PUB,
  };
}

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

  // OT-031: the shell - a real Stripe test card, delivered exactly once
  const card = m1.body.card;
  ok(
    !!card && /^\d{16}$/.test(card.number) && /^\d{3,4}$/.test(card.cvc),
    'active mandate returns one-time card details (real Stripe test card)',
  );
  const rePoll = await api('GET', `/v1/mandates/${m1.body.mandate_id}`, { key: secret });
  ok(rePoll.body.card === null, 'card details are not retrievable a second time');

  // OT-032: real-time authorization webhook (signed events)
  const signedWebhook = (payload) => {
    const body = JSON.stringify(payload);
    const t = Math.floor(Date.now() / 1000);
    const sig = cryptoModule
      .createHmac('sha256', env('STRIPE_WEBHOOK_SECRET'))
      .update(`${t}.${body}`)
      .digest('hex');
    return fetch(`${BASE}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` },
      body,
    });
  };
  const authEvent = (id, cardId, amount) => ({
    id,
    object: 'event',
    type: 'issuing_authorization.request',
    api_version: '2025-01-01',
    data: {
      object: {
        id: `iauth_${id}`,
        object: 'issuing.authorization',
        card: { id: cardId },
        amount: 0,
        approved: false,
        pending_request: { amount },
      },
    },
  });

  const whOk = await signedWebhook(authEvent(`evt_ok_${tabId.slice(0, 8)}`, card.card_id, 3400));
  ok(
    whOk.status === 200 && (await whOk.json()).approved === true,
    'webhook approves authorization matching active mandate',
  );

  const whOver = await signedWebhook(
    authEvent(`evt_over_${tabId.slice(0, 8)}`, card.card_id, 3401),
  );
  ok(
    (await whOver.json()).approved === false,
    'webhook declines authorization above mandate amount',
  );

  const whUnknown = await signedWebhook(
    authEvent(`evt_unk_${tabId.slice(0, 8)}`, 'ic_does_not_exist', 100),
  );
  ok(
    (await whUnknown.json()).approved === false,
    'webhook declines authorization without matching mandate',
  );

  const badSig = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
    body: JSON.stringify(authEvent('evt_forged', card.card_id, 1)),
  });
  ok(badSig.status === 400, 'webhook rejects invalid signature');

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
    body: signedReceipt({
      mandate_id: m2.body.mandate_id,
      merchant: 'https://new-store.test.invalid',
      amount_minor: 1000,
      idempotency_key: `held-${tabId}`,
    }),
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
    body: signedReceipt({
      mandate_id: m1.body.mandate_id,
      merchant: KNOWN,
      amount_minor: 3400,
      idempotency_key: `it-${tabId}`,
      evidence: { dom_sha256: 'e'.repeat(64) },
    }),
  });
  ok(r1.status === 201, 'receipt filed for active mandate');
  // the response is a complete SignedReceipt, verifiable offline (OT-060)
  const verdict = r1.body.receipt
    ? verifyReceipt(r1.body.receipt, {
        agent_public_key: r1.body.receipt.agent_public_key,
        ta_public_key: r1.body.receipt.ta_public_key,
      })
    : { valid: false };
  ok(verdict.valid, 'filed receipt verifies offline (agent + TA signatures)');

  // duplicate idempotency key
  const r2 = await api('POST', `/v1/mandates/${m1.body.mandate_id}/receipt`, {
    key: secret,
    body: signedReceipt({
      mandate_id: m1.body.mandate_id,
      merchant: KNOWN,
      amount_minor: 3400,
      idempotency_key: `it-${tabId}`,
    }),
  });
  ok(r2.status === 409, 'consumed mandate / duplicate key -> 409');

  // filing a receipt sheds the shell: the card dies with the purchase, not
  // only when a settlement webhook happens to arrive (OT-098's core claim)
  const mShed = await api('POST', `/v1/tabs/${tabId}/mandates`, {
    key: secret,
    body: {
      merchant_origin: KNOWN,
      amount_minor: 700,
      cart_hash: 'e'.repeat(64),
      reason: 'shed-on-file test',
      mcc: '5732',
    },
  });
  ok(mShed.status === 201, 'mandate for shed-on-file test minted');
  const filedShed = await api('POST', `/v1/mandates/${mShed.body.mandate_id}/receipt`, {
    key: secret,
    body: signedReceipt({
      mandate_id: mShed.body.mandate_id,
      merchant: KNOWN,
      amount_minor: 700,
      idempotency_key: `shed-${tabId}`,
    }),
  });
  ok(filedShed.status === 201, 'receipt filed');
  const [shedCard] =
    await sql`select status from cards where mandate_id = ${mShed.body.mandate_id}`;
  ok(
    !shedCard || shedCard.status === 'deactivated',
    `filing a receipt sheds the shell (card: ${shedCard?.status ?? 'none provisioned'})`,
  );

  // agent sheds an unworn shell: cancel refunds the reserved amount
  const budgetBefore = await api('GET', `/v1/tabs/${tabId}`, { key: secret });
  const mCancel = await api('POST', `/v1/tabs/${tabId}/mandates`, {
    key: secret,
    body: {
      merchant_origin: KNOWN,
      amount_minor: 500,
      cart_hash: 'f'.repeat(64),
      reason: 'cancel test',
      mcc: '5732',
    },
  });
  ok(mCancel.status === 201, 'mandate for cancel test minted');
  const del = await api('DELETE', `/v1/mandates/${mCancel.body.mandate_id}`, { key: secret });
  ok(del.status === 200 && del.body.status === 'revoked', 'agent cancels own unused mandate');
  const budgetAfter = await api('GET', `/v1/tabs/${tabId}`, { key: secret });
  ok(
    budgetAfter.body.remaining_minor === budgetBefore.body.remaining_minor,
    'cancel refunds the reserved amount',
  );
  const delAgain = await api('DELETE', `/v1/mandates/${mCancel.body.mandate_id}`, { key: secret });
  ok(delAgain.status === 409, 'canceled mandate cannot be canceled twice');

  // consumed mandate: webhook must now decline the same card
  const whConsumed = await signedWebhook(
    authEvent(`evt_used_${tabId.slice(0, 8)}`, card.card_id, 100),
  );
  ok((await whConsumed.json()).approved === false, 'webhook declines after mandate is consumed');

  // receipts list
  const list = await api('GET', `/v1/tabs/${tabId}/receipts`, { key: secret });
  ok(
    list.status === 200 &&
      list.body.receipts.some((r) => r.idempotency_key === `it-${tabId}`) &&
      list.body.receipts.some((r) => r.idempotency_key === `shed-${tabId}`),
    'receipts list returns filed receipts',
  );

  // --- the Tap (OT-024): deny path + refund, expiry auto-cancel ---
  const b64u = (s) => Buffer.from(s).toString('base64url');
  const stepUpToken = (mandateId) => {
    const header = b64u(JSON.stringify({ alg: 'HS256' }));
    const payload = b64u(
      JSON.stringify({
        typ: 'stepup',
        mandate_id: mandateId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    );
    const mac = cryptoModule
      .createHmac('sha256', env('MOLT_SESSION_SECRET'))
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${mac}`;
  };

  const before = (await api('GET', `/v1/tabs/${tabId}`, { key: secret })).body.remaining_minor;
  const deny = await api('POST', '/step-up/deny', {
    body: { token: stepUpToken(m2.body.mandate_id) },
  });
  ok(deny.status === 200 && deny.body.status === 'denied', 'step-up deny cancels the held mandate');
  const afterDeny = (await api('GET', `/v1/tabs/${tabId}`, { key: secret })).body.remaining_minor;
  ok(afterDeny === before + 1000, 'deny refunds the reserved budget');
  const polledDenied = await api('GET', `/v1/mandates/${m2.body.mandate_id}`, { key: secret });
  ok(polledDenied.body.status === 'denied', 'denied mandate visible to the agent');
  const denyAgain = await api('POST', '/step-up/deny', {
    body: { token: stepUpToken(m2.body.mandate_id) },
  });
  ok(denyAgain.status === 409, 'deny is not repeatable');

  // expiry auto-cancel: mint another held mandate, force it past TTL, poll
  const m5 = await api('POST', `/v1/tabs/${tabId}/mandates`, {
    key: secret,
    body: {
      merchant_origin: 'https://expiring.test.invalid',
      amount_minor: 2000,
      cart_hash: 'f'.repeat(64),
      reason: 'expiry test',
    },
  });
  ok(m5.status === 202, 'second held mandate minted');
  await sql`update mandates set expires_at = now() - interval '1 minute' where id = ${m5.body.mandate_id}`;
  const polledExpired = await api('GET', `/v1/mandates/${m5.body.mandate_id}`, { key: secret });
  ok(polledExpired.body.status === 'expired', 'held mandate past TTL auto-cancels on poll');
  const afterExpiry = (await api('GET', `/v1/tabs/${tabId}`, { key: secret })).body.remaining_minor;
  ok(afterExpiry === afterDeny, 'expiry refunds the reserved budget');
  const optionsExpired = await api('POST', '/step-up/options', {
    body: { token: stepUpToken(m5.body.mandate_id) },
  });
  ok(optionsExpired.status === 409, 'step-up options refuse a non-held mandate');

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
