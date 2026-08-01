/**
 * The ceremony binding (OT-021): the WebAuthn assertion challenge IS the
 * SHA-256 of the canonical root-mandate document. The fingerprint signs
 * these exact bounds — tampering with stored bounds is detectable by
 * recomputing the hash and comparing it to the challenge inside the stored
 * assertion's clientDataJSON.
 *
 * G3: this authenticates the user to Molt for mandate signing only.
 */
import { sha256CanonicalHex, type MandateBounds, type StepUpPolicy } from '@molt/protocol';

/** The exact document the ceremony signs. Field order is irrelevant (canonical JSON). */
export interface RootMandateDoc {
  bounds: MandateBounds;
  task_declaration: string;
  step_up_policy: StepUpPolicy;
}

/** Hex SHA-256 of the canonical mandate document. Stored as challenge_hash. */
export function mandateChallengeHex(doc: RootMandateDoc): string {
  return sha256CanonicalHex(doc);
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** The base64url challenge string as it appears in clientDataJSON. */
export function mandateChallengeBase64Url(doc: RootMandateDoc): string {
  return bytesToBase64Url(hexToBytes(mandateChallengeHex(doc)));
}

/**
 * Tamper check (OT-021 AC): recompute the hash from stored mandate fields and
 * compare against the challenge the stored assertion actually signed.
 */
export function verifyMandateBinding(
  doc: RootMandateDoc,
  storedAssertion: { response?: { clientDataJSON?: string } },
): boolean {
  const cdj = storedAssertion.response?.clientDataJSON;
  if (!cdj) return false;
  let clientData: { challenge?: string };
  try {
    clientData = JSON.parse(Buffer.from(cdj, 'base64url').toString('utf8')) as {
      challenge?: string;
    };
  } catch {
    return false;
  }
  return clientData.challenge === mandateChallengeBase64Url(doc);
}
