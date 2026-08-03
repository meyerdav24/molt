/**
 * Demo x402 seller (OT-113): a trivial paid API - one quote for $0.01
 * testnet USDC - exposed via x402 on Base Sepolia. It is the earn leg of
 * the demo loop and the integration-test target for the x402 client.
 *
 * Deliberately dependency-free at runtime (plain node http + fetch): the
 * envelope constants are inlined so the docker image stays tiny. G4: this
 * process knows only a receiving ADDRESS; it holds no key material.
 *
 * Verification and settlement are delegated to the x402 facilitator
 * (X402_FACILITATOR_URL, default the hosted testnet facilitator). Override
 * it in tests with a mock.
 */
import { createServer } from 'node:http';

const port = Number(process.env.DEMO_SELLER_PORT ?? 4021);
const payTo = process.env.DEMO_SELLER_PAY_TO_ADDRESS;
const facilitator = (process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator').replace(
  /\/+$/,
  '',
);

/** Base Sepolia testnet USDC (Circle); 0.01 USDC in atomic units. */
const ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const NETWORK = 'base-sepolia';
const PRICE_ATOMIC = process.env.DEMO_SELLER_PRICE_ATOMIC ?? '10000';

const QUOTES = [
  'The shell you shed today funds the shell you grow tomorrow.',
  'A bounded agent is a trusted agent.',
  'Spend like a crab: grow, wear once, shed.',
  'No approval, no shell.',
  'One cart, one shell, no regrets.',
];

function paymentRequirements(resource: string) {
  return {
    scheme: 'exact',
    network: NETWORK,
    maxAmountRequired: PRICE_ATOMIC,
    resource,
    description: 'One artisanal molt-themed quote',
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: 300,
    asset: ASSET,
    extra: { name: 'USDC', version: '2' },
  };
}

async function facilitatorCall(
  path: '/verify' | '/settle',
  paymentPayload: unknown,
  requirements: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${facilitator}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      x402Version: 1,
      paymentPayload,
      paymentRequirements: requirements,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'molt-demo-seller', network: NETWORK }));
    return;
  }

  // the whole API is paid: the root answers with the same 402 envelope so
  // platform detectors probing the origin see x402 immediately
  if (req.method === 'GET' && url.pathname === '/' && payTo) {
    res.writeHead(402, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        x402Version: 1,
        error: 'payment required',
        accepts: [paymentRequirements(`http://localhost:${port}/quote`)],
      }),
    );
    return;
  }

  if (req.method !== 'GET' || url.pathname !== '/quote') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', hint: 'GET /quote (x402 paid)' }));
    return;
  }

  if (!payTo) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'not_configured', detail: 'DEMO_SELLER_PAY_TO_ADDRESS unset' }),
    );
    return;
  }

  const requirements = paymentRequirements(url.toString());
  const header = req.headers['x-payment'];

  if (!header) {
    res.writeHead(402, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ x402Version: 1, error: 'payment required', accepts: [requirements] }));
    return;
  }

  let paymentPayload: unknown;
  try {
    paymentPayload = JSON.parse(Buffer.from(String(header), 'base64').toString('utf8'));
  } catch {
    res.writeHead(402, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        x402Version: 1,
        error: 'malformed payment header',
        accepts: [requirements],
      }),
    );
    return;
  }

  try {
    const verdict = await facilitatorCall('/verify', paymentPayload, requirements);
    if (!verdict.isValid) {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          x402Version: 1,
          error: `payment invalid: ${String(verdict.invalidReason ?? 'unknown')}`,
          accepts: [requirements],
        }),
      );
      return;
    }

    const settlement = await facilitatorCall('/settle', paymentPayload, requirements);
    if (!settlement.success) {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          x402Version: 1,
          error: `settlement failed: ${String(settlement.errorReason ?? 'unknown')}`,
          accepts: [requirements],
        }),
      );
      return;
    }

    res.writeHead(200, {
      'content-type': 'application/json',
      'x-payment-response': Buffer.from(JSON.stringify(settlement)).toString('base64'),
    });
    res.end(JSON.stringify({ quote: QUOTES[Math.floor(Math.random() * QUOTES.length)] }));
  } catch (e) {
    res.writeHead(502, {
      'content-type': 'application/json',
    });
    res.end(
      JSON.stringify({
        error: 'facilitator_unreachable',
        detail: e instanceof Error ? e.message : 'unknown',
      }),
    );
  }
}).listen(port, () => {
  console.error(
    `molt-demo-seller on :${port} - GET /quote costs 0.01 testnet USDC (${NETWORK}), pay-to ${payTo ?? 'UNSET'}`,
  );
});
