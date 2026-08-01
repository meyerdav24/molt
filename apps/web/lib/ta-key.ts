/**
 * The Tab Authority's receipt-countersigning key (OT-060).
 *
 * MOLT_TA_SIGNING_KEY holds a base64-encoded ed25519 PKCS#8 PEM. Base64
 * because .env files and PEM line breaks do not mix. Generate one with:
 *
 *   node -e "const {generateKeyPairSync}=require('crypto');
 *     console.log(Buffer.from(generateKeyPairSync('ed25519').privateKey
 *       .export({type:'pkcs8',format:'pem'})).toString('base64'))"
 *
 * This key signs receipts only. It is not a payment credential and holds no
 * funds (G1/G2); losing it costs verifiability of past receipts, nothing else.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';

export interface TaKeyPair {
  privatePem: string;
  publicPem: string;
}

let cached: TaKeyPair | null = null;

export function taSigningKey(): TaKeyPair {
  if (cached) return cached;
  const b64 = process.env.MOLT_TA_SIGNING_KEY;
  if (!b64) {
    throw new Error('MOLT_TA_SIGNING_KEY is not set (base64-encoded ed25519 PKCS#8 PEM)');
  }
  const privatePem = Buffer.from(b64, 'base64').toString('utf8');
  const key = createPrivateKey(privatePem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`MOLT_TA_SIGNING_KEY must be ed25519, got ${key.asymmetricKeyType}`);
  }
  const publicPem = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  cached = { privatePem, publicPem };
  return cached;
}
