export const metadata = { title: 'Quickstart - Molt' };

const pre: React.CSSProperties = {
  background: '#f6f6f6',
  padding: '0.7rem 0.9rem',
  borderRadius: 6,
  overflowX: 'auto',
  fontSize: '0.85rem',
};

/** Self-host in 10 minutes. Timed against a stranger per the OT-090 AC. */
export default function Quickstart() {
  return (
    <div>
      <h1>Quickstart: self-host in 10 minutes</h1>
      <p>
        You need Docker, Node 22+, pnpm, and a free Stripe account with Issuing enabled in test
        mode. Everything runs locally; no real money can move (the app refuses to boot with a live
        key).
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>1. Clone and configure</h2>
      <pre style={pre}>{`git clone https://github.com/meyerdav24/molt && cd molt
cp .env.example .env`}</pre>
      <p>
        Open <code>.env</code> and fill in four values (each is explained inline):
      </p>
      <ul>
        <li>
          <code>MOLT_SESSION_SECRET</code>: any long random string
        </li>
        <li>
          <code>MOLT_TA_SIGNING_KEY</code>: the generator one-liner is in the file
        </li>
        <li>
          <code>STRIPE_API_KEY</code>: a test-mode restricted key (rk_test_...) with Issuing
          Cardholders and Cards write access
        </li>
        <li>
          <code>EMAIL_API_KEY</code> + <code>EMAIL_FROM</code>: a Resend key, for step-up emails.
          Skippable at first; held purchases then wait without an email.
        </li>
      </ul>

      <h2 style={{ fontSize: '1.1rem' }}>2. Run it</h2>
      <pre style={pre}>{`docker compose up`}</pre>
      <p>
        Postgres comes up with the schema applied, the web app (the Tab Authority) listens on{' '}
        <a href="http://localhost:3000">localhost:3000</a>. Check <code>/api/v1/health</code>: it
        must say <code>&quot;mode&quot;: &quot;test&quot;</code>.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>3. Open a tab (the one human moment)</h2>
      <p>
        Register at <code>/login</code> with a passkey, then open a tab: set total budget, per
        purchase max, expiry, categories, and the step-up policy. Your passkey signs exactly these
        limits. In the dashboard, create an agent key for the tab; it is shown once.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>4. Connect an agent</h2>
      <p>
        Follow <a href="/docs/mcp">Claude Desktop / MCP</a> with the agent key from step 3. For a
        first purchase you need a Shopify store to buy from; a free{' '}
        <a href="https://shopify.dev/docs/api/development-stores">development store</a> with the
        Bogus payment gateway works out of the box (add its host to{' '}
        <code>MOLT_BOGUS_GATEWAY_HOSTS</code> in the MCP server env, because test-mode issuing cards
        cannot be charged across Stripe accounts).
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>5. Buy something, then verify the receipt</h2>
      <p>
        Ask the agent to buy an item. Watch the tab detail page: shell grown, worn once, shed.
        Download the receipt JSON from the dashboard and check it offline:
      </p>
      <pre style={pre}>{`npx molt verify receipt.json`}</pre>
      <p>
        Contributors who prefer running without Docker: <code>pnpm install</code>,{' '}
        <code>pnpm build</code>, then <code>pnpm --filter @molt/web dev</code> against any Postgres,
        same <code>.env</code>.
      </p>
    </div>
  );
}
