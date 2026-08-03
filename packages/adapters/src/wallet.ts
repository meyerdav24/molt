/**
 * Agent wallet bootstrap (OT-112), non-custodial by construction (G4):
 * the key is generated on the operator's machine, stored encrypted at rest
 * (scrypt + AES-256-GCM), and never leaves it. The Tab Authority sees only
 * addresses and receipts; there is deliberately no code path that could
 * upload key material.
 *
 * Testnet only in v1: Base Sepolia, Circle's testnet USDC.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export const BASE_SEPOLIA_CHAIN_ID = 84532;
/** Circle's official testnet USDC on Base Sepolia. */
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const DEFAULT_RPC_URL = 'https://sepolia.base.org';

interface KeystoreFile {
  version: 1;
  /** Public by design - the TA and the demo seller only ever see this. */
  address: `0x${string}`;
  crypto: {
    kdf: 'scrypt';
    salt: string;
    n: number;
    r: number;
    p: number;
    cipher: 'aes-256-gcm';
    iv: string;
    ciphertext: string;
    tag: string;
  };
}

const SCRYPT = { n: 2 ** 15, r: 8, p: 1 };

function deriveKey(passphrase: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(passphrase, salt, 32, { N: n, r, p, maxmem: 256 * 1024 * 1024 });
}

/** Generate a fresh wallet and write the encrypted keystore. Refuses to overwrite. */
export function initWallet(
  path: string,
  passphrase: string,
): { address: `0x${string}`; path: string } {
  if (existsSync(path)) {
    throw new Error(`${path} already exists; refusing to overwrite a wallet`);
  }
  if (passphrase.length < 8) {
    throw new Error('passphrase must be at least 8 characters');
  }
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt, SCRYPT.n, SCRYPT.r, SCRYPT.p);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKey.slice(2), 'hex')),
    cipher.final(),
  ]);

  const file: KeystoreFile = {
    version: 1,
    address: account.address,
    crypto: {
      kdf: 'scrypt',
      salt: salt.toString('hex'),
      ...SCRYPT,
      cipher: 'aes-256-gcm',
      iv: iv.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
    },
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  return { address: account.address, path };
}

/** Read the public address without needing the passphrase. */
export function walletAddress(path: string): `0x${string}` {
  const file = JSON.parse(readFileSync(path, 'utf8')) as KeystoreFile;
  return file.address;
}

/** Decrypt the keystore into a viem account (in memory only, never logged). */
export function loadWallet(path: string, passphrase: string) {
  const file = JSON.parse(readFileSync(path, 'utf8')) as KeystoreFile;
  const c = file.crypto;
  const key = deriveKey(passphrase, Buffer.from(c.salt, 'hex'), c.n, c.r, c.p);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(c.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(c.tag, 'hex'));
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(Buffer.from(c.ciphertext, 'hex')), decipher.final()]);
  } catch {
    throw new Error('wrong passphrase (or corrupted keystore)');
  }
  const account = privateKeyToAccount(`0x${plain.toString('hex')}`);
  // belt and braces: the derived address must match the stored one
  if (
    !timingSafeEqual(
      Buffer.from(account.address.toLowerCase()),
      Buffer.from(file.address.toLowerCase()),
    )
  ) {
    throw new Error('keystore address mismatch');
  }
  return account;
}

/** Testnet USDC balance in minor units (6 decimals), via plain JSON-RPC. */
export async function usdcBalance(
  address: string,
  rpcUrl: string = DEFAULT_RPC_URL,
): Promise<bigint> {
  const data = `0x70a08231${address.toLowerCase().replace('0x', '').padStart(64, '0')}`;
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: BASE_SEPOLIA_USDC, data }, 'latest'],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (!body.result) throw new Error(`rpc error: ${body.error?.message ?? res.status}`);
  return BigInt(body.result);
}
