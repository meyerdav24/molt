/**
 * OT-110: the client pays exactly when it should, and the signature it
 * produces recovers to the wallet address (verified with viem, no chain
 * needed). A mock seller stands in for the counterparty.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import { fetchWithX402, ALLOWED_NETWORK, BASE_SEPOLIA_CHAIN_ID } from './x402.js';
import { BASE_SEPOLIA_USDC } from './wallet.js';

const account = privateKeyToAccount(generatePrivateKey());
const PAY_TO = '0x1111111111111111111111111111111111111111';

let server: Server;
let base: string;
/** captured payment header of the last paid request */
let lastPayment: string | null = null;
let mode: 'free' | 'paid' | 'mainnet-only' | 'garbage' = 'paid';

function envelope(network: string) {
  return {
    x402Version: 1,
    error: 'payment required',
    accepts: [
      {
        scheme: 'exact',
        network,
        maxAmountRequired: '10000', // 0.01 USDC
        resource: `${base}/quote`,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        asset: BASE_SEPOLIA_USDC,
        extra: { name: 'USDC', version: '2' },
      },
    ],
  };
}

before(async () => {
  server = createServer((req, res) => {
    if (mode === 'free') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ quote: 'gratis' }));
      return;
    }
    if (mode === 'garbage') {
      res.writeHead(402, { 'content-type': 'text/plain' });
      res.end('pay me somehow');
      return;
    }
    const network = mode === 'mainnet-only' ? 'base' : ALLOWED_NETWORK;
    const payment = req.headers['x-payment'];
    if (!payment) {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(JSON.stringify(envelope(network)));
      return;
    }
    lastPayment = String(payment);
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-payment-response': Buffer.from(
        JSON.stringify({ success: true, transaction: '0x' + 'ab'.repeat(32), network }),
      ).toString('base64'),
    });
    res.end(
      JSON.stringify({ quote: 'the shell you shed today funds the shell you grow tomorrow' }),
    );
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(() => server.close());

test('non-402 endpoints are fetched without any payment', async () => {
  mode = 'free';
  const out = await fetchWithX402(`${base}/quote`, { account, maxAmountMinor: 10_000n });
  assert.ok(out.ok && !out.paid && out.status === 200);
});

test('402 -> signed EIP-3009 resubmit -> settlement info', async () => {
  mode = 'paid';
  lastPayment = null;
  const out = await fetchWithX402(`${base}/quote`, { account, maxAmountMinor: 10_000n });
  assert.ok(
    out.ok && out.paid,
    `expected paid outcome, got ${'reason' in out ? out.reason : out.status}`,
  );
  assert.equal(out.amount_minor, 10_000n);
  assert.equal(out.settlement?.success, true);
  assert.match(out.settlement?.transaction ?? '', /^0x[0-9a-f]{64}$/);

  // the captured header must contain a signature that recovers to our wallet
  const payload = JSON.parse(Buffer.from(String(lastPayment), 'base64').toString('utf8'));
  assert.equal(payload.scheme, 'exact');
  assert.equal(payload.network, ALLOWED_NETWORK);
  const auth = payload.payload.authorization;
  assert.equal(auth.from, account.address);
  assert.equal(auth.to, PAY_TO);
  const valid = await verifyTypedData({
    address: account.address,
    domain: {
      name: 'USDC',
      version: '2',
      chainId: BASE_SEPOLIA_CHAIN_ID,
      verifyingContract: BASE_SEPOLIA_USDC,
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
    signature: payload.payload.signature,
  });
  assert.equal(valid, true);
});

test('an amount above the cap is refused before any signature', async () => {
  mode = 'paid';
  lastPayment = null;
  const out = await fetchWithX402(`${base}/quote`, { account, maxAmountMinor: 9_999n });
  assert.ok(!out.ok && out.reason === 'amount_exceeds_cap');
  assert.equal(lastPayment, null); // nothing was ever signed or sent
});

test('non-testnet terms are refused, never negotiated', async () => {
  mode = 'mainnet-only';
  lastPayment = null;
  const out = await fetchWithX402(`${base}/quote`, { account, maxAmountMinor: 10_000n });
  assert.ok(!out.ok && out.reason === 'network_not_allowed');
  assert.equal(lastPayment, null);
});

test('a 402 without an envelope fails structured', async () => {
  mode = 'garbage';
  const out = await fetchWithX402(`${base}/quote`, { account, maxAmountMinor: 10_000n });
  assert.ok(!out.ok && out.reason === 'no_402_envelope');
});
