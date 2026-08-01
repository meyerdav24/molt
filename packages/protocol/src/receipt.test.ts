/** OT-060: sign -> verify round trip, tamper detection, cross-rail sameness. */
import { strict as assert } from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import {
  countersignReceiptAsTa,
  signReceiptAsAgent,
  verifyReceipt,
  type ReceiptBody,
} from './receipt.js';
import type { Receipt } from './types.js';

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const BODY: ReceiptBody = {
  id: '11111111-1111-4111-8111-111111111111',
  tab_id: '22222222-2222-4222-8222-222222222222',
  mandate_id: '44444444-4444-4444-8444-444444444444',
  rung: 'L1',
  rail: 'card_stripe_test',
  merchant: 'https://store.example.com',
  amount_minor: 3400,
  currency: 'EUR',
  evidence: { dom_sha256: 'a'.repeat(64), screenshot_sha256: 'b'.repeat(64) },
  idempotency_key: 'c'.repeat(64),
  mandate_chain: ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'],
  created_at: '2026-08-01T12:00:00.000Z',
};

function sign(body: ReceiptBody = BODY) {
  const agent = keys();
  const ta = keys();
  const agentSig = signReceiptAsAgent(body, agent.priv);
  const taSig = countersignReceiptAsTa(body, agentSig, ta.priv);
  const receipt: Receipt = { ...body, agent_signature: agentSig, ta_signature: taSig };
  return { receipt, pubs: { agent_public_key: agent.pub, ta_public_key: ta.pub }, agent, ta };
}

test('sign -> verify round trip passes', () => {
  const { receipt, pubs } = sign();
  const r = verifyReceipt(receipt, pubs);
  assert.ok(r.valid, r.problems.join('; '));
  assert.ok(r.agent_signature_valid && r.ta_signature_valid);
});

test('one changed byte in the body breaks both signatures', () => {
  const { receipt, pubs } = sign();
  const tampered = { ...receipt, amount_minor: 3401 };
  const r = verifyReceipt(tampered, pubs);
  assert.ok(!r.valid);
  assert.ok(!r.agent_signature_valid, 'agent signature must fail');
  assert.ok(!r.ta_signature_valid, 'countersignature must fail too');
});

test('changed evidence hash is detected', () => {
  const { receipt, pubs } = sign();
  const tampered = { ...receipt, evidence: { ...receipt.evidence, dom_sha256: 'f'.repeat(64) } };
  assert.ok(!verifyReceipt(tampered, pubs).valid);
});

test('swapping the agent signature invalidates the countersignature', () => {
  const a = sign();
  const b = sign();
  const frankenstein = { ...a.receipt, agent_signature: b.receipt.agent_signature };
  const r = verifyReceipt(frankenstein, a.pubs);
  assert.ok(!r.valid);
  assert.ok(!r.ta_signature_valid, 'TA countersigned a different agent signature');
});

test('wrong public keys do not verify', () => {
  const { receipt } = sign();
  const other = sign();
  assert.ok(!verifyReceipt(receipt, other.pubs).valid);
});

test('mandate chain must end at the receipt mandate', () => {
  const bad: ReceiptBody = { ...BODY, mandate_chain: [BODY.mandate_chain[0]!, 'something-else'] };
  const { receipt, pubs } = sign(bad);
  const r = verifyReceipt(receipt, pubs);
  assert.ok(!r.valid);
  assert.ok(r.agent_signature_valid, 'signatures are fine, structure is not');
  assert.ok(r.problems.some((p) => p.includes('mandate chain')));
});

test('on-chain receipts verify identically to card receipts', () => {
  const onchain: ReceiptBody = {
    ...BODY,
    rail: 'usdc_x402_testnet',
    rung: 'L0',
    evidence: { onchain_tx_hash: '0x' + 'd'.repeat(64) },
  };
  const { receipt, pubs } = sign(onchain);
  assert.ok(verifyReceipt(receipt, pubs).valid);
});

test('key order in the document does not change the signature', () => {
  const agent = keys();
  const reordered = Object.fromEntries(Object.entries(BODY).reverse()) as unknown as ReceiptBody;
  assert.equal(signReceiptAsAgent(BODY, agent.priv), signReceiptAsAgent(reordered, agent.priv));
});
