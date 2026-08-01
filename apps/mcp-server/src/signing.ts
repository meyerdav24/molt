/**
 * The agent's receipt-signing key (OT-060, agent half). ed25519, generated on
 * first use, stored with owner-only permissions. This key signs receipt
 * bodies; it is not a payment credential and cannot move money (G2: the
 * issuer rails execute payments, signatures only attest).
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AgentSigningKey {
  privatePem: string;
  publicPem: string;
}

export function loadOrCreateSigningKey(path: string): AgentSigningKey {
  let privatePem: string;
  if (existsSync(path)) {
    privatePem = readFileSync(path, 'utf8');
    const key = createPrivateKey(privatePem);
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error(`${path} is not an ed25519 key (got ${key.asymmetricKeyType})`);
    }
  } else {
    const pair = generateKeyPairSync('ed25519');
    privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, privatePem, { mode: 0o600 });
  }
  const publicPem = createPublicKey(createPrivateKey(privatePem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
  return { privatePem, publicPem };
}
