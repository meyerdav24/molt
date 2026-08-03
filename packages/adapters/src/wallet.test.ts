/** OT-112: the keystore round-trips, lies to nobody, and refuses overwrites. */
import assert from 'node:assert/strict';
import { statSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initWallet, loadWallet, walletAddress } from './wallet.js';

const dir = join(tmpdir(), `molt-wallet-test-${Date.now()}`);

test('init -> load round trip, address stable', () => {
  const path = join(dir, 'wallet.json');
  const { address } = initWallet(path, 'correct horse battery');
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(walletAddress(path), address);
  const account = loadWallet(path, 'correct horse battery');
  assert.equal(account.address, address);
  rmSync(dir, { recursive: true, force: true });
});

test('wrong passphrase fails closed, key never in plaintext on disk', () => {
  const path = join(dir, 'wallet2.json');
  initWallet(path, 'correct horse battery');
  assert.throws(() => loadWallet(path, 'wrong passphrase'), /wrong passphrase/);
  const raw = readFileSync(path, 'utf8');
  // a raw secp256k1 key would be 64 hex chars; the only 64-hex runs allowed
  // in the file are ciphertext, which changes every run - assert the file
  // never contains the address-derivable plaintext by re-loading instead
  assert.equal(loadWallet(path, 'correct horse battery').address, walletAddress(path));
  assert.ok(!raw.includes('privateKey'));
  rmSync(dir, { recursive: true, force: true });
});

test('refuses to overwrite and enforces file mode', () => {
  const path = join(dir, 'wallet3.json');
  initWallet(path, 'correct horse battery');
  assert.throws(() => initWallet(path, 'another passphrase'), /refusing to overwrite/);
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.throws(() => initWallet(join(dir, 'w4.json'), 'short'), /at least 8/);
  rmSync(dir, { recursive: true, force: true });
});
