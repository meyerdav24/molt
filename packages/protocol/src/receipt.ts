/**
 * Receipt signing and verification (OT-060).
 *
 * A receipt is dual-signed: the agent signs the receipt body, the Tab
 * Authority countersigns (body + agent signature). Both are ed25519 over
 * the canonical JSON, so verification needs nothing but the document and
 * the two public keys - no network, no database. That is what makes
 * `molt verify receipt.json` meaningful.
 *
 * The shape is identical for card and on-chain rails; only `rail` and the
 * evidence fields differ.
 */
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { canonicalJson } from './canonical.js';
import type { Receipt } from './types.js';

/** The receipt body: everything except the two signatures. */
export type ReceiptBody = Omit<Receipt, 'agent_signature' | 'ta_signature'>;

/** A receipt as it travels: body + signatures + the keys needed to verify it. */
export interface SignedReceipt extends Receipt {
  /** SPKI PEM of the agent key that signed the body. */
  agent_public_key: string;
  /** SPKI PEM of the Tab Authority key that countersigned. */
  ta_public_key: string;
}

function bodyOf(receipt: ReceiptBody | Receipt): ReceiptBody {
  const { ...rest } = receipt as Receipt;
  delete (rest as Partial<Receipt>).agent_signature;
  delete (rest as Partial<Receipt>).ta_signature;
  delete (rest as Partial<SignedReceipt>).agent_public_key;
  delete (rest as Partial<SignedReceipt>).ta_public_key;
  return rest as ReceiptBody;
}

function signBytes(data: string, privateKeyPem: string): string {
  return edSign(null, Buffer.from(data, 'utf8'), createPrivateKey(privateKeyPem)).toString(
    'base64',
  );
}

function verifyBytes(data: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    return edVerify(
      null,
      Buffer.from(data, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}

/** Agent signs the canonical receipt body. */
export function signReceiptAsAgent(body: ReceiptBody, agentPrivateKeyPem: string): string {
  return signBytes(canonicalJson(bodyOf(body)), agentPrivateKeyPem);
}

/**
 * The TA countersigns body + agent signature: the countersignature is only
 * valid for that exact agent signature, so neither half can be swapped.
 */
export function countersignReceiptAsTa(
  body: ReceiptBody,
  agentSignature: string,
  taPrivateKeyPem: string,
): string {
  return signBytes(
    canonicalJson({ body: bodyOf(body), agent_signature: agentSignature }),
    taPrivateKeyPem,
  );
}

export interface VerificationResult {
  valid: boolean;
  agent_signature_valid: boolean;
  ta_signature_valid: boolean;
  /** Human-readable reasons for failure, empty when valid. */
  problems: string[];
}

/** Offline verification: document + public keys, nothing else. */
export function verifyReceipt(
  receipt: Receipt,
  keys: { agent_public_key: string; ta_public_key: string },
): VerificationResult {
  const problems: string[] = [];
  const body = bodyOf(receipt);
  const canonicalBody = canonicalJson(body);

  const agentOk = verifyBytes(canonicalBody, receipt.agent_signature, keys.agent_public_key);
  if (!agentOk) problems.push('agent signature does not match the receipt body');

  const taOk = verifyBytes(
    canonicalJson({ body, agent_signature: receipt.agent_signature }),
    receipt.ta_signature,
    keys.ta_public_key,
  );
  if (!taOk) problems.push('Tab Authority countersignature does not match');

  // Structural sanity: the chain must end at the mandate the receipt is for.
  if (receipt.mandate_chain[receipt.mandate_chain.length - 1] !== receipt.mandate_id) {
    problems.push('mandate chain does not end at the receipt mandate');
  }
  if (receipt.mandate_chain.length < 2) {
    problems.push('mandate chain must contain at least a root and a child mandate');
  }

  return {
    valid: problems.length === 0,
    agent_signature_valid: agentOk,
    ta_signature_valid: taOk,
    problems,
  };
}
