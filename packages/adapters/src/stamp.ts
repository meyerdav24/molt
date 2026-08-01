/**
 * The Stamp (OT-055): identity over stealth, no exceptions.
 *
 * Every automated request carries an RFC 9421 HTTP Message Signature with
 * the agent's registered key, a Tab-Context header carrying the child
 * mandate hash (TA-countersigned once receipt signing lands in OT-060),
 * and an honest user agent. There is no stealth code path in this package
 * and there never will be: no fingerprint spoofing, no CAPTCHA solving.
 * A merchant that blocks us gets a structured `blocked_by_merchant` result.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';

/** Honest UA on all adapter traffic. Identifies the implementation and where to read about it. */
export const MOLT_USER_AGENT =
  'Molt-Agent/0.1 (+https://github.com/meyerdav24/molt) identity-over-stealth';

/** Covered components, fixed for v1. Order matters: it is part of the signature base. */
export const COVERED_COMPONENTS = ['@method', '@target-uri', 'date', 'tab-context'] as const;

export interface AgentKeyPair {
  /** PKCS8 PEM, ed25519. Lives with the agent operator, never with the TA. */
  privateKeyPem: string;
  /** SPKI PEM. Registered with the TA; published for merchants to verify. */
  publicKeyPem: string;
}

export function generateAgentSigningKey(): AgentKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/**
 * Tab-Context header value: the child-mandate challenge hash, plus the TA
 * countersignature once available (OT-060). Merchants and CDNs can use it
 * to verify that a specific, bounded mandate stands behind the request.
 */
export function buildTabContext(mandateHashHex: string, taSignature?: string): string {
  return taSignature ? `${mandateHashHex};ta-sig=${taSignature}` : mandateHashHex;
}

export interface SignRequestInput {
  method: string;
  /** Absolute target URI of the request. */
  url: string;
  /** RFC 9110 Date header value. */
  date: string;
  /** Tab-Context header value (buildTabContext). */
  tabContext: string;
  keyId: string;
  privateKeyPem: string;
  /** Unix seconds for the created parameter. */
  created: number;
}

export interface SignedHeaders {
  date: string;
  'tab-context': string;
  'user-agent': string;
  'signature-input': string;
  signature: string;
}

/** RFC 9421 signature base for the fixed covered components. */
export function buildSignatureBase(input: Omit<SignRequestInput, 'privateKeyPem'>): string {
  const params = signatureParams(input.keyId, input.created);
  return [
    `"@method": ${input.method.toUpperCase()}`,
    `"@target-uri": ${input.url}`,
    `"date": ${input.date}`,
    `"tab-context": ${input.tabContext}`,
    `"@signature-params": ${params}`,
  ].join('\n');
}

function signatureParams(keyId: string, created: number): string {
  const components = COVERED_COMPONENTS.map((c) => `"${c}"`).join(' ');
  return `(${components});created=${created};keyid="${keyId}";alg="ed25519"`;
}

/** Sign a request. Returns every header the adapter must attach. */
export function signRequest(input: SignRequestInput): SignedHeaders {
  const base = buildSignatureBase(input);
  const signature = edSign(null, Buffer.from(base, 'utf8'), createPrivateKey(input.privateKeyPem));
  return {
    date: input.date,
    'tab-context': input.tabContext,
    'user-agent': MOLT_USER_AGENT,
    'signature-input': `sig1=${signatureParams(input.keyId, input.created)}`,
    signature: `sig1=:${signature.toString('base64')}:`,
  };
}

export interface VerifyRequestInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  publicKeyPem: string;
}

/** Verify a stamped request from its headers. */
export function verifyRequest(input: VerifyRequestInput): boolean {
  const sigInput = input.headers['signature-input'];
  const sigHeader = input.headers['signature'];
  const date = input.headers['date'];
  const tabContext = input.headers['tab-context'];
  if (!sigInput || !sigHeader || !date || tabContext === undefined) return false;

  const created = /;created=(\d+)/.exec(sigInput)?.[1];
  const keyId = /;keyid="([^"]+)"/.exec(sigInput)?.[1];
  const sigB64 = /^sig1=:([A-Za-z0-9+/=]+):$/.exec(sigHeader)?.[1];
  if (!created || !keyId || !sigB64) return false;

  const base = buildSignatureBase({
    method: input.method,
    url: input.url,
    date,
    tabContext,
    keyId,
    created: Number(created),
  });
  try {
    return edVerify(
      null,
      Buffer.from(base, 'utf8'),
      createPublicKey(input.publicKeyPem),
      Buffer.from(sigB64, 'base64'),
    );
  } catch {
    return false;
  }
}

/** Structured, honest failure when a merchant blocks automated traffic. */
export interface BlockedByMerchant {
  error: 'blocked_by_merchant';
  merchant: string;
  http_status?: number;
  detail: string;
}

export function blockedByMerchant(
  merchant: string,
  detail: string,
  httpStatus?: number,
): BlockedByMerchant {
  return {
    error: 'blocked_by_merchant',
    merchant,
    detail,
    ...(httpStatus !== undefined ? { http_status: httpStatus } : {}),
  };
}
