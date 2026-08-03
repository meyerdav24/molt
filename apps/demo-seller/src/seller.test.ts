/**
 * OT-113 AC: the seller returns a valid 402 envelope and settles via the
 * facilitator; the OT-110 client drives it end to end. The facilitator is
 * mocked in-process, but it REALLY verifies the EIP-3009 signature (viem),
 * so the whole cryptographic path runs in CI without a chain.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { fetchWithX402, BASE_SEPOLIA_CHAIN_ID } from '@molt/adapters';
import { verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(generatePrivateKey());
const PAY_TO = '0x2222222222222222222222222222222222222222';
const SELLER_PORT = 42000 + Math.floor(Math.random() * 1000);

let facilitator: Server;
let seller: ChildProcess;
let settleCalls = 0;

before(async () => {
  // mock facilitator with real signature verification
  facilitator = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      void (async () => {
        const { paymentPayload, paymentRequirements } = JSON.parse(body);
        const auth = paymentPayload.payload.authorization;
        const valid = await verifyTypedData({
          address: auth.from,
          domain: {
            name: 'USDC',
            version: '2',
            chainId: BASE_SEPOLIA_CHAIN_ID,
            verifyingContract: paymentRequirements.asset,
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
            from: auth.from,
            to: auth.to,
            value: BigInt(auth.value),
            validAfter: BigInt(auth.validAfter),
            validBefore: BigInt(auth.validBefore),
            nonce: auth.nonce,
          },
          signature: paymentPayload.payload.signature,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/verify') {
          res.end(
            JSON.stringify({ isValid: valid, invalidReason: valid ? undefined : 'bad signature' }),
          );
        } else {
          settleCalls++;
          res.end(
            JSON.stringify(
              valid
                ? {
                    success: true,
                    transaction: `0x${'cd'.repeat(32)}`,
                    network: 'base-sepolia',
                    payer: auth.from,
                  }
                : { success: false, errorReason: 'bad signature' },
            ),
          );
        }
      })();
    });
  });
  await new Promise<void>((r) => facilitator.listen(0, () => r()));
  const fAddr = facilitator.address();
  const fPort = typeof fAddr === 'object' && fAddr ? fAddr.port : 0;

  const here = dirname(fileURLToPath(import.meta.url));
  seller = spawn('node', [join(here, '../dist/index.js')], {
    env: {
      ...process.env,
      DEMO_SELLER_PORT: String(SELLER_PORT),
      DEMO_SELLER_PAY_TO_ADDRESS: PAY_TO,
      X402_FACILITATOR_URL: `http://127.0.0.1:${fPort}`,
    },
    stdio: 'pipe',
  });
  let childErr = '';
  seller.stderr?.on('data', (c) => (childErr += c));
  // wait for the seller to answer (CI runners cold-start slowly)
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${SELLER_PORT}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (seller.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`seller did not come up (exit ${seller.exitCode}): ${childErr.slice(0, 400)}`);
});

after(() => {
  seller.kill();
  facilitator.close();
});

test('unpaid request gets a valid 402 envelope', async () => {
  const res = await fetch(`http://127.0.0.1:${SELLER_PORT}/quote`);
  assert.equal(res.status, 402);
  const envelope = await res.json();
  assert.equal(envelope.x402Version, 1);
  const terms = envelope.accepts[0];
  assert.equal(terms.scheme, 'exact');
  assert.equal(terms.network, 'base-sepolia');
  assert.equal(terms.payTo, PAY_TO);
  assert.equal(terms.maxAmountRequired, '10000');
});

test('the x402 client pays and gets the quote + settlement header', async () => {
  const out = await fetchWithX402(`http://127.0.0.1:${SELLER_PORT}/quote`, {
    account,
    maxAmountMinor: 10_000n,
  });
  assert.ok(out.ok && out.paid, `expected paid, got ${'reason' in out ? out.reason : out.status}`);
  assert.equal(out.status, 200);
  assert.match(JSON.parse(out.body).quote, /\w/);
  assert.equal(out.settlement?.success, true);
  assert.match(out.settlement?.transaction ?? '', /^0x[0-9a-f]{64}$/);
  assert.ok(settleCalls >= 1);
});

test('a garbage payment header is refused without settlement', async () => {
  const before = settleCalls;
  const res = await fetch(`http://127.0.0.1:${SELLER_PORT}/quote`, {
    headers: { 'x-payment': 'bm90LXZhbGlk' },
  });
  assert.equal(res.status, 402);
  assert.equal(settleCalls, before);
});
