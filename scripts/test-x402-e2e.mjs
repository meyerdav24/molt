/**
 * OT-111 end-to-end: the MCP purchase tool pays an x402 endpoint on the L0
 * rung - mandate minted for exactly the quoted amount, bounds enforced
 * before signing, receipt filed with the tx hash, verifiable offline.
 *
 * Two modes:
 *   node scripts/test-x402-e2e.mjs           # mock facilitator (default; CI-safe)
 *   node scripts/test-x402-e2e.mjs --real    # hosted facilitator, real Base
 *                                            # Sepolia settlement (needs funded
 *                                            # wallet + MOLT_WALLET_PASSPHRASE)
 *
 * Requires the web app running.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REAL = process.argv.includes('--real');

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const postgres = webRequire('postgres');
const mcpRequire = createRequire(new URL('../apps/mcp-server/package.json', import.meta.url));
const { Client } = await import(mcpRequire.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StdioClientTransport } = await import(
  mcpRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js')
);
const { verifyReceipt } = await import('../packages/protocol/dist/index.js');
const { verifyTypedData } = await import(
  createRequire(new URL('../packages/adapters/package.json', import.meta.url)).resolve('viem')
);
const { usdcBalance } = await import('../packages/adapters/dist/wallet.js');

function env(name) {
  const m = readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!m) throw new Error(`${name} not in .env`);
  return m[1];
}

const sql = postgres(env('DATABASE_URL'), { prepare: false, max: 2 });
let passed = 0;
function ok(cond, name) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`ok: ${name}`);
  }
}

// --- seed tab (auto-approve policy) -----------------------------------------
const userId = randomUUID();
const tabId = randomUUID();
const rootId = randomUUID();
const secret = `molt_sk_test_${randomBytes(24).toString('hex')}`;
const expires = new Date(Date.now() + 24 * 3600_000).toISOString();
const bounds = {
  amount_minor: 5000,
  currency: 'EUR',
  per_tx_max_minor: 1000,
  expires_at: expires,
  mcc_allowlist: [],
  velocity_per_hour: 10,
  merchant_scope: '*',
};
const policy = {
  unknown_merchant: 'allow',
  amount_above_baseline: 'allow',
  mcc_outside_allowlist: 'block',
  velocity_exceeded: 'block',
};
await sql`insert into users (id, email) values (${userId}, ${`x402-${userId}@test.invalid`})`;
await sql`insert into tabs (id, user_id, total_minor, remaining_minor, expires_at)
          values (${tabId}, ${userId}, 5000, 5000, ${expires})`;
await sql`insert into mandates (id, tab_id, kind, status, bounds, amount_minor, currency,
            merchant_scope, task_declaration, step_up_policy, webauthn_assertion, challenge_hash, expires_at)
          values (${rootId}, ${tabId}, 'root', 'active', ${sql.json(bounds)}, 5000, 'EUR', '*',
            'x402 e2e: buy one quote from the paid API', ${sql.json(policy)}, '{}', ${'0'.repeat(64)}, ${expires})`;
await sql`insert into agent_keys (tab_id, user_id, key_hash, key_prefix)
          values (${tabId}, ${userId}, ${createHash('sha256').update(secret).digest('hex')},
                  ${secret.slice(0, 19)})`;

// --- mock facilitator (only when not --real) --------------------------------
let facilitatorUrl = env('X402_FACILITATOR_URL') || 'https://x402.org/facilitator';
let facilitator = null;
if (!REAL) {
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
            chainId: 84532,
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
        res.end(
          JSON.stringify(
            req.url === '/verify'
              ? { isValid: valid, invalidReason: valid ? undefined : 'bad signature' }
              : valid
                ? {
                    success: true,
                    transaction: `0x${randomBytes(32).toString('hex')}`,
                    network: 'base-sepolia',
                    payer: auth.from,
                  }
                : { success: false, errorReason: 'bad signature' },
          ),
        );
      })();
    });
  });
  await new Promise((r) => facilitator.listen(0, r));
  facilitatorUrl = `http://127.0.0.1:${facilitator.address().port}`;
}

// --- demo seller ------------------------------------------------------------
const SELLER_PORT = 43000 + Math.floor(Math.random() * 1000);
const agentAddress = env('MOLT_AGENT_WALLET_ADDRESS');
const seller = spawn('node', ['apps/demo-seller/dist/index.js'], {
  env: {
    ...process.env,
    DEMO_SELLER_PORT: String(SELLER_PORT),
    DEMO_SELLER_PAY_TO_ADDRESS: agentAddress,
    X402_FACILITATOR_URL: facilitatorUrl,
  },
  stdio: 'pipe',
});
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${SELLER_PORT}/health`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 100));
}

// --- MCP client -------------------------------------------------------------
const scratch = join(tmpdir(), `molt-x402-${Date.now()}`);
const transport = new StdioClientTransport({
  command: 'node',
  args: ['apps/mcp-server/dist/index.js'],
  env: {
    ...process.env,
    MOLT_API_URL: 'http://localhost:3000',
    MOLT_AGENT_KEY: secret,
    MOLT_EVIDENCE_DIR: scratch,
    MOLT_AGENT_SIGNING_KEY_PATH: join(scratch, 'agent-signing-key.pem'),
    MOLT_WALLET_PATH: `${process.env.HOME}/.molt/wallet.json`,
    MOLT_WALLET_PASSPHRASE: env('MOLT_WALLET_PASSPHRASE'),
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'x402-e2e', version: '0.0.1' });

try {
  await client.connect(transport);
  const call = async (name, args) =>
    JSON.parse(
      (await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })).content[0]
        .text,
    );

  const sellerUrl = `http://127.0.0.1:${SELLER_PORT}/quote`;

  // resolve_merchant sees the 402
  const detection = await call('resolve_merchant', { url: sellerUrl });
  ok(detection.platform === 'x402' && detection.recommended_rung === 'L0', 'detector says x402/L0');

  const balBefore = REAL ? await usdcBalance(agentAddress) : 0n;

  // the L0 purchase: no items, mandate for exactly 0.01 USDC -> 1 cent
  const bought = await call('purchase', {
    tab_id: tabId,
    merchant_url: sellerUrl,
    max_amount_minor: 10,
    reason: 'x402 e2e: one quote from the paid API',
  });
  if (bought.status !== 'purchased') console.error('outcome:', JSON.stringify(bought, null, 2));
  ok(bought.status === 'purchased', `L0 purchase completes (${bought.status})`);
  if (bought.status === 'purchased') {
    ok(
      bought.receipt.rung === 'L0' && bought.receipt.rail === 'usdc_x402_testnet',
      'receipt says L0/usdc',
    );
    ok(
      /^0x[0-9a-f]{64}$/.test(bought.receipt.evidence.onchain_tx_hash ?? ''),
      'tx hash in evidence',
    );
    const verdict = verifyReceipt(bought.receipt, {
      agent_public_key: bought.receipt.agent_public_key,
      ta_public_key: bought.receipt.ta_public_key,
    });
    ok(verdict.valid, 'molt verify accepts the tx-hash receipt');
    const [m] =
      await sql`select status, amount_minor from mandates where id = ${bought.receipt.mandate_id}`;
    ok(
      m?.status === 'consumed' && Number(m.amount_minor) === 1,
      'mandate minted for 1 cent, consumed',
    );
  }

  // an endpoint asking more than the cap is refused BEFORE anything is
  // minted or signed (a second seller instance with a 2.00 price)
  const priceyPort = SELLER_PORT + 1;
  const pricey = spawn('node', ['apps/demo-seller/dist/index.js'], {
    env: {
      ...process.env,
      DEMO_SELLER_PORT: String(priceyPort),
      DEMO_SELLER_PAY_TO_ADDRESS: agentAddress,
      DEMO_SELLER_PRICE_ATOMIC: '2000000',
      X402_FACILITATOR_URL: facilitatorUrl,
    },
    stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${priceyPort}/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const childrenBefore = (
    await sql`select count(*)::int as n from mandates where tab_id = ${tabId} and kind = 'child'`
  )[0].n;
  const tooMuch = await call('purchase', {
    tab_id: tabId,
    merchant_url: `http://127.0.0.1:${priceyPort}/quote`,
    max_amount_minor: 100,
    reason: 'must be refused: 2.00 endpoint against a 1.00 cap',
  });
  pricey.kill();
  ok(
    tooMuch.status === 'refused' && tooMuch.reason === 'quote_exceeds_max_amount',
    `over-cap endpoint refused before minting (${tooMuch.status}/${tooMuch.reason})`,
  );
  const childrenAfter = (
    await sql`select count(*)::int as n from mandates where tab_id = ${tabId} and kind = 'child'`
  )[0].n;
  ok(childrenAfter === childrenBefore, 'no mandate was minted for the refused attempt');

  if (REAL) {
    // give the chain a moment, then the agent paid itself: balance unchanged
    await new Promise((r) => setTimeout(r, 5000));
    const balAfter = await usdcBalance(agentAddress);
    console.log(
      `  on-chain: agent balance ${Number(balBefore) / 1e6} -> ${Number(balAfter) / 1e6} USDC (self-payment nets zero)`,
    );
    ok(balAfter === balBefore, 'self-payment settled on-chain, net zero');
  }
} finally {
  await client.close().catch(() => {});
  seller.kill();
  facilitator?.close();
  await sql`delete from users where id = ${userId}`;
  await sql.end();
}

console.log(
  `\n${passed} assertions passed${REAL ? ' (REAL on-chain settlement)' : ' (mock facilitator)'}`,
);
