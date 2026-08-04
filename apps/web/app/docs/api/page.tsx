export const metadata = { title: 'API reference - Molt' };

const pre: React.CSSProperties = {
  background: '#f6f6f6',
  padding: '0.7rem 0.9rem',
  borderRadius: 6,
  overflowX: 'auto',
  fontSize: '0.8rem',
};

interface Endpoint {
  method: string;
  path: string;
  auth: 'agent key' | 'none' | 'session';
  what: string;
  responses: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/v1/health',
    auth: 'none',
    what: 'Liveness and the mode gate result.',
    responses: '200 {ok, service, mode:"test"}',
  },
  {
    method: 'POST',
    path: '/api/v1/tabs',
    auth: 'none',
    what: 'Start opening a tab. Returns the ceremony URL for the human owner; agents cannot self-authorize.',
    responses: '200 {ceremony_url, message}',
  },
  {
    method: 'GET',
    path: '/api/v1/tabs/:id',
    auth: 'agent key',
    what: 'Tab status: budget, remaining, expiry, the root bounds and task declaration.',
    responses: '200 · 401 · 404',
  },
  {
    method: 'POST',
    path: '/api/v1/tabs/:id/mandates',
    auth: 'agent key',
    what: 'Request a child mandate for one cart: merchant_origin, amount_minor, cart_hash, reason, optional mcc and items_summary. Policy decides (auto / notify / hold for tap / block), the narrowing engine enforces the invariant, budget and velocity are atomic.',
    responses:
      '201 active {mandate_id, parent_id, bounds, card (one-time)} · 202 held {mandate_id, message} · 403 blocked_by_policy · 409 tab_not_active/budget · 422 narrowing_violation · 429 velocity',
  },
  {
    method: 'GET',
    path: '/api/v1/mandates/:id',
    auth: 'agent key',
    what: 'Mandate status; the polling target for held mandates. Card details are delivered exactly once, on the first read after approval.',
    responses: '200 {status, bounds, cart_hash, parent_id, card|null} · 404',
  },
  {
    method: 'DELETE',
    path: '/api/v1/mandates/:id',
    auth: 'agent key',
    what: 'Shed an unworn shell: cancels an unused child mandate, the card dies, the reserved amount returns to the tab.',
    responses: '200 {ok, status:"revoked"} · 404 · 409 mandate_not_cancelable',
  },
  {
    method: 'POST',
    path: '/api/v1/mandates/:id/receipt',
    auth: 'agent key',
    what: 'File the dual-signed receipt. The agent generates id and created_at, signs the canonical body; the TA verifies, enforces mandate constraints and idempotency, countersigns, and returns the complete SignedReceipt.',
    responses:
      '201 {ok, receipt: SignedReceipt} · 400 · 409 mandate_not_usable/duplicate_idempotency_key · 422 amount/merchant/currency/chain/signature',
  },
  {
    method: 'GET',
    path: '/api/v1/tabs/:id/receipts',
    auth: 'agent key',
    what: 'All receipts for the tab, newest first.',
    responses: '200 {receipts: [...]}',
  },
];

/** Hand-written from the route sources; an OpenAPI document follows later. */
export default function ApiDocs() {
  return (
    <div>
      <h1>API reference</h1>
      <p>
        The Tab Authority REST surface, versioned under <code>/api/v1</code>. Agent endpoints
        authenticate with a tab-scoped key: <code>Authorization: Bearer molt_sk_test_...</code>.
        Errors are JSON:{' '}
        <code>
          {'{'}error: &quot;code&quot;, ...detail{'}'}
        </code>
        . All amounts are integer minor units (cents).
      </p>

      {ENDPOINTS.map((e) => (
        <section key={`${e.method} ${e.path}`} style={{ marginBottom: '1.1rem' }}>
          <p style={{ marginBottom: '0.2rem' }}>
            <code>
              <strong>{e.method}</strong> {e.path}
            </code>{' '}
            <span style={{ color: '#888', fontSize: '0.8rem' }}>auth: {e.auth}</span>
          </p>
          <p style={{ margin: '0.2rem 0', color: '#444' }}>{e.what}</p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#777' }}>{e.responses}</p>
        </section>
      ))}

      <h2 style={{ fontSize: '1.1rem' }}>Filing a receipt</h2>
      <pre style={pre}>{`POST /api/v1/mandates/:id/receipt
{
  "receipt": {
    "id": "<uuid, agent-generated>",
    "tab_id": "...", "mandate_id": "...",
    "rung": "L1", "rail": "card_stripe_test",
    "merchant": "https://store.example.com",
    "amount_minor": 3400, "currency": "EUR",
    "evidence": {"dom_sha256": "...", "screenshot_sha256": "..."},
    "idempotency_key": "<sha256(tab|merchant|cart_hash)>",
    "mandate_chain": ["<root id>", "<child id>"],
    "created_at": "<ISO 8601, within 10 minutes>"
  },
  "agent_signature": "<ed25519 over canonical JSON of receipt>",
  "agent_public_key": "<SPKI PEM>"
}`}</pre>
      <p>
        The response embeds <code>ta_signature</code> and <code>ta_public_key</code>; the document
        verifies offline with <code>pnpm exec molt verify receipt.json</code>, no network and no
        database needed.
      </p>
    </div>
  );
}
