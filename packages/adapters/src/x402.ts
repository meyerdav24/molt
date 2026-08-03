/**
 * x402 client (OT-110): the L0 rung. Detect HTTP 402 + payment-requirements
 * envelope, sign an EIP-3009 transfer authorization from the agent's LOCAL
 * wallet, resubmit with the payment header, and read the settlement result.
 *
 * Guardrails baked in, not bolted on:
 * - G4: the private key lives in the operator's keystore (wallet.ts) and is
 *   used only to sign typed data in-process. Nothing here can upload it.
 * - Test mode: the chain allowlist is HARD-CODED to Base Sepolia. A 402
 *   offering any other network is refused, not negotiated.
 * - The amount cap is enforced BEFORE any signature exists (OT-111 wires
 *   the child-mandate bounds into that cap).
 */
import { randomBytes } from 'node:crypto';
import type { PrivateKeyAccount } from 'viem/accounts';
import { BASE_SEPOLIA_USDC } from './wallet.js';
import { MOLT_USER_AGENT } from './stamp.js';

export const X402_VERSION = 1;
/** Test mode negotiates exactly one network, ever. */
export const ALLOWED_NETWORK = 'base-sepolia';
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** One entry of the 402 envelope's `accepts` array (x402 v1, scheme "exact"). */
export interface PaymentRequirements {
  scheme: string;
  network: string;
  /** Atomic units (USDC: 6 decimals), as a decimal string. */
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds?: number;
  asset: `0x${string}`;
  extra?: { name?: string; version?: string };
}

export interface X402Envelope {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirements[];
}

export interface SettlementInfo {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
}

export type X402Outcome =
  | { ok: true; paid: false; status: number; body: string }
  | {
      ok: true;
      paid: true;
      status: number;
      body: string;
      amount_minor: bigint;
      pay_to: string;
      settlement: SettlementInfo | null;
    }
  | { ok: false; reason: X402FailureReason; detail: string };

export type X402FailureReason =
  | 'no_402_envelope'
  | 'no_acceptable_terms'
  | 'network_not_allowed'
  | 'amount_exceeds_cap'
  | 'payment_rejected'
  | 'endpoint_unreachable';

/** The signed payment header payload (x402 v1, scheme "exact"). */
interface PaymentPayload {
  x402Version: number;
  scheme: 'exact';
  network: string;
  payload: {
    signature: `0x${string}`;
    authorization: {
      from: `0x${string}`;
      to: `0x${string}`;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: `0x${string}`;
    };
  };
}

export interface X402RequestOptions {
  account: PrivateKeyAccount;
  /** Hard cap in atomic units; nothing above this is ever signed. */
  maxAmountMinor: bigint;
  method?: string;
  timeoutMs?: number;
}

async function safeFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
}

/** Parse a 402 response body into the envelope, or null. */
export function parseEnvelope(body: string): X402Envelope | null {
  try {
    const parsed = JSON.parse(body) as X402Envelope;
    if (!Array.isArray(parsed.accepts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Fetch a resource, paying via x402 if (and only if) the counterparty asks,
 * the terms are on the allowed testnet, and the amount fits under the cap.
 */
export async function fetchWithX402(url: string, opts: X402RequestOptions): Promise<X402Outcome> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const method = opts.method ?? 'GET';
  const headers = { 'user-agent': MOLT_USER_AGENT };

  const first = await safeFetch(url, { method, headers }, timeoutMs);
  if (!first)
    return { ok: false, reason: 'endpoint_unreachable', detail: `no response from ${url}` };
  if (first.status !== 402) {
    return { ok: true, paid: false, status: first.status, body: await first.text() };
  }

  const envelope = parseEnvelope(await first.text());
  if (!envelope) {
    return {
      ok: false,
      reason: 'no_402_envelope',
      detail: '402 without a parseable x402 envelope',
    };
  }

  const exactTerms = envelope.accepts.filter((a) => a.scheme === 'exact');
  if (exactTerms.length === 0) {
    return { ok: false, reason: 'no_acceptable_terms', detail: 'no "exact" scheme offered' };
  }
  const terms = exactTerms.find((a) => a.network === ALLOWED_NETWORK);
  if (!terms) {
    return {
      ok: false,
      reason: 'network_not_allowed',
      detail: `offered networks [${exactTerms.map((a) => a.network).join(', ')}]; test mode pays only on ${ALLOWED_NETWORK}`,
    };
  }

  const amount = BigInt(terms.maxAmountRequired);
  // the cap check happens BEFORE any signature is created
  if (amount > opts.maxAmountMinor) {
    return {
      ok: false,
      reason: 'amount_exceeds_cap',
      detail: `endpoint asks ${amount} atomic units, cap is ${opts.maxAmountMinor}`,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: opts.account.address,
    to: terms.payTo,
    value: amount.toString(),
    validAfter: String(now - 60),
    validBefore: String(now + (terms.maxTimeoutSeconds ?? 300)),
    nonce: `0x${randomBytes(32).toString('hex')}` as `0x${string}`,
  };

  const signature = await opts.account.signTypedData({
    domain: {
      name: terms.extra?.name ?? 'USDC',
      version: terms.extra?.version ?? '2',
      chainId: BASE_SEPOLIA_CHAIN_ID,
      verifyingContract: terms.asset ?? BASE_SEPOLIA_USDC,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value: amount,
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const payment: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: 'exact',
    network: ALLOWED_NETWORK,
    payload: { signature, authorization },
  };

  const paid = await safeFetch(
    url,
    {
      method,
      headers: {
        ...headers,
        'x-payment': Buffer.from(JSON.stringify(payment)).toString('base64'),
      },
    },
    timeoutMs,
  );
  if (!paid) {
    return { ok: false, reason: 'endpoint_unreachable', detail: 'endpoint vanished after quoting' };
  }
  if (paid.status === 402) {
    return {
      ok: false,
      reason: 'payment_rejected',
      detail: `endpoint rejected the payment (${(await paid.text()).slice(0, 200)})`,
    };
  }

  let settlement: SettlementInfo | null = null;
  const settlementHeader = paid.headers.get('x-payment-response');
  if (settlementHeader) {
    try {
      settlement = JSON.parse(Buffer.from(settlementHeader, 'base64').toString('utf8'));
    } catch {
      settlement = null;
    }
  }

  return {
    ok: true,
    paid: true,
    status: paid.status,
    body: await paid.text(),
    amount_minor: amount,
    pay_to: terms.payTo,
    settlement,
  };
}
