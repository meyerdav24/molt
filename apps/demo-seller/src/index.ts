/**
 * Demo x402 seller (OT-113, Phase 3). Phase 0 scaffold.
 *
 * Will serve a small paid endpoint at $0.01 testnet USDC via x402
 * (Base Sepolia only — guardrail G4: operator-owned wallets, no custody,
 * no key material in the TA).
 */
import { createServer } from 'node:http';

const port = Number(process.env.DEMO_SELLER_PORT ?? 4021);

createServer((_req, res) => {
  // x402 middleware lands in OT-113; until then this is an honest placeholder.
  res.writeHead(503, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({ error: 'not_implemented', detail: 'x402 seller lands in Phase 3 (OT-113)' }),
  );
}).listen(port, () => {
  console.error(`demo-seller placeholder listening on :${port}`);
});
