export const metadata = { title: 'Docs - Molt' };

/** Overview: the model in one screen, merchant deliberately outside the box. */
export default function DocsOverview() {
  const box = (label: string, sub: string, color: string) => (
    <div
      style={{
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: '0.6rem 0.9rem',
        textAlign: 'center' as const,
        minWidth: 130,
      }}
    >
      <strong>{label}</strong>
      <div style={{ fontSize: '0.8rem', color: '#666' }}>{sub}</div>
    </div>
  );

  return (
    <div>
      <h1>Molt</h1>
      <p>
        Delegate bounded spending to an AI agent. You open a tab once: show ID with your passkey,
        set a budget and rules. For every purchase the agent grows a disposable{' '}
        <strong>shell</strong>, a payment credential sized to exactly one cart. It wears the shell
        once and sheds it. The agent molts after every purchase; it never touches your real card.
      </p>

      <h2 style={{ fontSize: '1.15rem' }}>The three-party model</h2>
      <div
        style={{
          display: 'flex',
          gap: '0.8rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          margin: '1rem 0',
        }}
      >
        {box('You', 'passkey, limits, taps', '#0a7d33')}
        <span>→</span>
        {box('Tab Authority', 'verifies, scopes, countersigns', '#333')}
        <span>→</span>
        {box('Agent', 'shops, wears one shell', '#0a5bd3')}
        <span
          style={{
            border: '2px dashed #bbb',
            borderRadius: 8,
            padding: '0.6rem 0.9rem',
            color: '#888',
            textAlign: 'center',
          }}
        >
          <strong>Merchant</strong>
          <div style={{ fontSize: '0.8rem' }}>outside the box, changes nothing</div>
        </span>
      </div>
      <p style={{ color: '#555' }}>
        The Tab Authority never holds funds and never initiates payments. It authorizes and scopes;
        issuer rails execute. Merchants need no integration: the agent checks out like any customer,
        while identifying itself honestly on every request.
      </p>

      <h2 style={{ fontSize: '1.15rem' }}>The invariant everything rests on</h2>
      <p>
        A child mandate can never exceed its parent on any dimension: amount, expiry, merchant
        scope, category, velocity. Each shell is scoped to one merchant, one cart hash, one amount,
        minutes of lifetime. A fully compromised agent cannot reach a store the tab has never paid,
        and at a store already on record it is bounded by the per-purchase cap, the velocity limit,
        and what is left of the tab. Anything unusual is held for a passkey tap on your phone: no
        approval, no shell.
      </p>

      <h2 style={{ fontSize: '1.15rem' }}>Where to go</h2>
      <ul>
        <li>
          <a href="/docs/quickstart">Quickstart</a>: self-host and reach a working purchase.
        </li>
        <li>
          <a href="/docs/mcp">Claude Desktop / MCP</a>: connect an agent.
        </li>
        <li>
          <a href="/docs/api">API reference</a>: the Tab Authority REST surface.
        </li>
        <li>
          <a href="/docs/spec">Protocol spec</a>: normative rules, threat model, non-goals.
        </li>
        <li>
          <a href="/docs/faq">FAQ</a>: the questions you should ask.
        </li>
      </ul>
    </div>
  );
}
