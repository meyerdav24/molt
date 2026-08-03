export const metadata = { title: 'Agent wallet - Molt' };

const pre: React.CSSProperties = {
  background: '#f6f6f6',
  padding: '0.7rem 0.9rem',
  borderRadius: 6,
  overflowX: 'auto',
  fontSize: '0.85rem',
};

/** OT-112: non-custodial wallet bootstrap and faucet walkthrough. */
export default function WalletDocs() {
  return (
    <div>
      <h1>Agent wallet (x402, testnet)</h1>
      <p>
        The x402 rung pays machine-to-machine with testnet USDC on Base Sepolia. The custody model
        is deliberate and simple: <strong>you own the keys</strong>. The wallet is generated on your
        machine, stored encrypted at rest (scrypt and AES-256-GCM, file mode 600), and never
        uploaded. The Tab Authority sees addresses and receipts, nothing else; there is no
        server-side wallet code at all.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>1. Create the wallet</h2>
      <pre style={pre}>{`pnpm wallet:init`}</pre>
      <p>
        Pick a passphrase (at least 8 characters, remember it; it is needed to sign payments). The
        command prints your address. Non-interactive environments can set{' '}
        <code>MOLT_WALLET_PASSPHRASE</code>; the file lives at <code>~/.molt/wallet.json</code> or
        wherever <code>MOLT_WALLET_PATH</code> points.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>2. Fund it (free, ~2 minutes)</h2>
      <p>
        Open <a href="https://faucet.circle.com">faucet.circle.com</a>, choose{' '}
        <strong>Base Sepolia</strong> as the network, paste your address, request USDC. This is
        Circle&apos;s official testnet faucet; the tokens are play money. You do not need any ETH:
        x402 payments are signed transfer authorizations (EIP-3009) and the facilitator carries the
        gas.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>3. Verify</h2>
      <pre style={pre}>{`pnpm wallet:balance`}</pre>
      <p>Faucet transfers usually land within a minute.</p>

      <h2 style={{ fontSize: '1.1rem' }}>Custody model, stated plainly</h2>
      <ul>
        <li>Keys are generated and stored only on the operator&apos;s machine.</li>
        <li>The Tab Authority never sees, stores, or transports key material (guardrail G4).</li>
        <li>Testnet only in v1: the chain allowlist is hard-coded to Base Sepolia in test mode.</li>
        <li>
          Losing the passphrase loses the wallet. It holds testnet tokens, so the correct recovery
          is: create a new one.
        </li>
      </ul>
    </div>
  );
}
