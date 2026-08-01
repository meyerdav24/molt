/**
 * The Tap v1 (OT-024): asynchronous step-up via email link.
 *
 * The link alone never approves anything - it opens a page that requires a
 * fresh WebAuthn assertion. The assertion signs an AMENDMENT to the tab
 * (challenge = SHA-256 of the canonical amendment document), never a new
 * root. Deny is one tap and needs no passkey: denying narrows authority.
 * Step-up requests expire with the held mandate's 15-minute TTL.
 */
import { SignJWT, jwtVerify } from 'jose';
import { sha256CanonicalHex } from '@molt/protocol';

const TOKEN_TTL_S = 15 * 60;

function key(): Uint8Array {
  const secret = process.env.MOLT_SESSION_SECRET;
  if (!secret) throw new Error('MOLT_SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

/** Signed link token: proves the bearer got the email, nothing more. */
export async function createStepUpToken(mandateId: string): Promise<string> {
  return new SignJWT({ typ: 'stepup', mandate_id: mandateId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_S}s`)
    .sign(key());
}

export async function verifyStepUpToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    if (payload.typ !== 'stepup' || typeof payload.mandate_id !== 'string') return null;
    return payload.mandate_id;
  } catch {
    return null;
  }
}

export interface TapAmendment {
  kind: 'tap_amendment';
  action: 'approve_child';
  tab_id: string;
  mandate_id: string;
  amount_minor: number;
  merchant_scope: string;
  cart_hash: string;
}

/** Hex SHA-256 of the canonical amendment - the WebAuthn challenge. */
export function amendmentChallengeHex(a: TapAmendment): string {
  return sha256CanonicalHex(a);
}
