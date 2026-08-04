export const metadata = { title: 'Claude Desktop / MCP - Molt' };

const pre: React.CSSProperties = {
  background: '#f6f6f6',
  padding: '0.7rem 0.9rem',
  borderRadius: 6,
  overflowX: 'auto',
  fontSize: '0.8rem',
};

/** Connecting an agent over MCP: config, the four tools, the outcomes. */
export default function McpDocs() {
  return (
    <div>
      <h1>Claude Desktop / MCP</h1>
      <p>
        The MCP server is the agent surface of the Tab Authority. Four tools, stdio transport by
        default, SSE with <code>--sse [port]</code>. Build it once with <code>pnpm build</code>.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>Configuration</h2>
      <p>
        Any MCP client works. Hermes Agent (<code>~/.hermes/config.yaml</code>, then{' '}
        <code>/reload-mcp</code>):
      </p>
      <pre style={pre}>{`mcp_servers:
  molt:
    command: "node"
    args: ["/path/to/molt/apps/mcp-server/dist/index.js"]
    env:
      MOLT_API_URL: "https://moltprotocol.dev"
      MOLT_AGENT_KEY: "molt_sk_test_..."
      MOLT_SHIPPING_PROFILE: '{"email":"you@example.com","first_name":"Ada","last_name":"Lovelace","address1":"Teststr. 1","city":"Munich","zip":"80331","country_code":"DE"}'`}</pre>
      <p>Claude Desktop (claude_desktop_config.json):</p>
      <pre style={pre}>{`{
  "mcpServers": {
    "molt": {
      "command": "node",
      "args": ["/path/to/molt/apps/mcp-server/dist/index.js"],
      "env": {
        "MOLT_API_URL": "https://moltprotocol.dev",
        "MOLT_AGENT_KEY": "molt_sk_test_...",
        "MOLT_SHIPPING_PROFILE": "{\\"email\\":\\"you@example.com\\",\\"first_name\\":\\"Ada\\",\\"last_name\\":\\"Lovelace\\",\\"address1\\":\\"Teststr. 1\\",\\"city\\":\\"Munich\\",\\"zip\\":\\"80331\\",\\"country_code\\":\\"DE\\"}"
      }
    }
  }
}`}</pre>
      <p>
        <code>MOLT_API_URL</code> points at the Tab Authority you use: the hosted beta
        (moltprotocol.dev) or your own instance (http://localhost:3000 with docker compose).
        Optional: <code>MOLT_STOREFRONT_PASSWORDS</code> (host|password pairs for password-protected
        dev stores), <code>MOLT_BOGUS_GATEWAY_HOSTS</code>, <code>MOLT_EVIDENCE_DIR</code>,{' '}
        <code>MOLT_CHECKOUT_TIMEOUT_MS</code>, <code>MOLT_AUDIT_LOG_PATH</code>;{' '}
        <code>MOLT_WALLET_PATH</code> + <code>MOLT_WALLET_PASSPHRASE</code> for the x402 rung (see{' '}
        <a href="/docs/wallet">agent wallet</a>). The agent key is scoped to one tab; the key prefix
        is enforced to be a test key at boot.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>The four tools</h2>
      <ul>
        <li>
          <code>open_tab()</code>: returns the ceremony URL for the human. The agent can never
          self-authorize a tab.
        </li>
        <li>
          <code>resolve_merchant(url)</code>: classifies the platform (shopify / x402 / unknown) and
          recommends the execution rung.
        </li>
        <li>
          <code>purchase(tab_id, merchant_url, items, max_amount_minor, reason, mandate_id?)</code>:
          quotes the real checkout total with no card involved, mints a child mandate scoped to
          exactly that cart, gets a single-use card, checks out behind an exact-total preflight,
          files a dual-signed receipt.
        </li>
        <li>
          <code>get_receipts(tab_id)</code>: every receipt with rung, rail, amounts, evidence hashes
          and the mandate chain.
        </li>
      </ul>

      <h2 style={{ fontSize: '1.1rem' }}>Purchase outcomes the agent must handle</h2>
      <ul>
        <li>
          <code>purchased</code>: done; the receipt is in the result and verifiable offline.
        </li>
        <li>
          <code>step_up_pending</code>: the purchase is held; the user got an email (the Tap). Retry
          later with the returned <code>mandate_id</code>.
        </li>
        <li>
          <code>handoff_l3</code>: no supported checkout protocol; give the human the link.
        </li>
        <li>
          <code>already_purchased</code>: this exact cart was bought on this tab before; the double
          order is refused before anything is minted.
        </li>
        <li>
          <code>refused</code>: the Tab Authority said no (limits, policy, narrowing). Do not retry
          unchanged.
        </li>
        <li>
          <code>failed</code>: checkout aborted; the shell was shed, the budget refunded, nothing
          was charged.
        </li>
      </ul>

      <h2 style={{ fontSize: '1.1rem' }}>Remote clients (Claude Cowork connectors)</h2>
      <p>
        Cowork and Claude.ai reach custom connectors from Anthropic&apos;s cloud, so they need a
        public HTTPS URL - unlike Hermes or Claude Desktop, which start the server locally. The Molt
        server must stay on your machine anyway (it drives real browsers and your wallet keys never
        leave it), so the shape is: run it locally, expose it through a tunnel.
      </p>
      <pre style={pre}>{`# 1. a token: this port can spend a tab, so it is never open without one
export MOLT_REMOTE_TOKEN=$(openssl rand -hex 24)

# 2. run the remote transport (plus the usual MOLT_* variables)
node apps/mcp-server/dist/index.js --http 3940

# 3. a public URL for it
cloudflared tunnel --url http://localhost:3940     # or: ngrok http 3940`}</pre>
      <p>
        In Cowork: <strong>Customize → Connectors → +</strong>, name it Molt, URL{' '}
        <code>https://your-tunnel-host/mcp</code>. Add the token as an
        <code> Authorization: Bearer …</code> header where the connector settings allow custom
        headers.
      </p>
      <p style={{ color: '#a02020' }}>
        Treat that URL like a credential. Anyone holding it and the token can spend the tab it is
        configured for - bounded by the tab&apos;s limits, which is the point, but bounded is not
        the same as harmless. Stop the tunnel when you are done, and revoke the tab&apos;s agent key
        if the URL leaked.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>Starting without a key works</h2>
      <p>
        You can register the server before any tab exists: leave <code>MOLT_AGENT_KEY</code> out
        entirely. <code>open_tab</code> and <code>resolve_merchant</code> work immediately;
        <code>purchase</code> answers with instructions instead of failing silently, so the agent
        itself walks you through the ceremony, and once you hand it the key panel&apos;s config
        block it completes its own setup. No file editing, no system prompt.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>Key lifecycle, plainly</h2>
      <ul>
        <li>
          One key belongs to exactly one tab and inherits its limits; that is the blast-radius
          model, not an inconvenience. Several tabs mean several molt entries in your config, each
          with its own key.
        </li>
        <li>
          Nothing about expiry lives in your config. When a tab expires or is revoked, the key
          simply starts answering <code>tab_not_active</code>; your agent reports it and you remove
          the entry (or ask the agent to).
        </li>
        <li>
          Creating a new key for a tab kills the previous one immediately. Lost keys are not
          recoverable, only replaceable.
        </li>
      </ul>

      <h2 style={{ fontSize: '1.1rem' }}>Recommended agent instructions</h2>
      <p>
        The tool descriptions already teach the mechanics; these standing instructions make any
        agent behave well on top. Paste them into your agent&apos;s system prompt or project
        instructions and fill in the tab id:
      </p>
      <pre style={pre}>{`You can buy things through Molt under a spending tab the user approved
with their passkey. Rules:

- Before buying at a store, call resolve_merchant on its URL once.
- Buy one cart per store visit with purchase(). Set max_amount_minor to
  the exact price you expect in cents. Give a short honest reason per
  purchase.
- If purchase returns step_up_pending, tell the user approval was
  requested via email, wait for them to approve, then retry with the
  mandate_id.
- If a purchase is refused or fails, report the structured reason and
  stop. Never retry a refused request unchanged. Never work around a
  limit.
- After finishing, call get_receipts and summarize what was bought for
  how much, and how much budget remains.

The tab id is: <TAB_ID>`}</pre>

      <p>
        Every automated request carries an RFC 9421 signature and an honest user agent. If a
        merchant blocks automation, the purchase fails with <code>blocked_by_merchant</code>; there
        is no stealth mode to turn on.
      </p>
    </div>
  );
}
