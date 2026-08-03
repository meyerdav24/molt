import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { MandateBounds } from '@molt/protocol';
import { db } from '../../../../lib/db';
import { getSessionUserId } from '../../../../lib/session';
import { KeyButton } from '../../key-button';
import { RevokeButton } from '../../revoke-button';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tab detail (OT-070): bounds, spend progress, the mandate tree, receipts,
 * event log, agent keys. Carries the molt storyline (OT-098): shell counter
 * (grown / worn / shed), a shed marker per receipt row, lifecycle wording in
 * the event log. One icon and three words, no animation festival.
 */

const eur = (minor: string | number, currency = 'EUR') =>
  `${(Number(minor) / 100).toFixed(2)} ${currency}`;

const shortId = (id: string) => id.slice(0, 8);

/** Terminal states: the shell (or held request) is gone for good. */
const SHED_STATES = new Set(['consumed', 'revoked', 'expired', 'denied']);

/** Lifecycle wording per VOCAB.md: shells grown, worn once, shed. */
function lifecycleLabel(type: string, actor: string): string | null {
  switch (type) {
    case 'mandate.activated':
      return 'shell grown';
    case 'mandate.approved':
      return 'shell grown (approved by tap)';
    case 'receipt.filed':
      return 'shell worn once';
    case 'mandate.canceled':
      return actor === 'agent' ? 'shell shed (unworn)' : 'shell shed';
    case 'mandate.expired':
      return 'shell shed (expired unworn)';
    case 'mandate.held':
      return 'held for your approval';
    case 'mandate.denied':
      return 'denied, no shell';
    case 'mandate.refused':
      return 'refused by the narrowing rule, no shell';
    case 'stepup.requested':
      return 'approval email sent';
    default:
      return null;
  }
}

const STATUS_COLOR: Record<string, string> = {
  active: '#0a7d33',
  approved: '#0a7d33',
  held: '#b06f00',
  consumed: '#555',
  revoked: '#888',
  expired: '#888',
  denied: '#a02020',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        color: STATUS_COLOR[status] ?? '#555',
        border: `1px solid ${STATUS_COLOR[status] ?? '#ccc'}`,
        borderRadius: 4,
        padding: '0 0.35rem',
        fontSize: '0.8rem',
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

export default async function TabDetailPage({ params }: { params: { id: string } }) {
  const userId = await getSessionUserId();
  if (!userId) redirect('/login');

  const sql = db();
  const [tab] = await sql<
    {
      id: string;
      status: string;
      currency: string;
      total_minor: string;
      remaining_minor: string;
      expires_at: string;
      created_at: string;
    }[]
  >`select id, status, currency, total_minor, remaining_minor, expires_at, created_at
    from tabs where id = ${params.id} and user_id = ${userId}`;
  if (!tab) notFound();

  const [root] = await sql<
    { id: string; status: string; bounds: MandateBounds; task_declaration: string }[]
  >`select id, status, bounds, task_declaration
    from mandates where tab_id = ${tab.id} and kind = 'root'`;

  const children = await sql<
    {
      id: string;
      status: string;
      amount_minor: string;
      currency: string;
      merchant_scope: string;
      reason: string | null;
      created_at: string;
    }[]
  >`select id, status, amount_minor, currency, merchant_scope, reason, created_at
    from mandates where tab_id = ${tab.id} and kind = 'child'
    order by created_at desc`;

  const receipts = await sql<
    {
      id: string;
      mandate_id: string;
      rung: string;
      rail: string;
      merchant: string;
      amount_minor: string;
      currency: string;
      idempotency_key: string;
      ta_signature: string | null;
      created_at: string;
    }[]
  >`select id, mandate_id, rung, rail, merchant, amount_minor, currency,
           idempotency_key, ta_signature, created_at
    from receipts where tab_id = ${tab.id} order by created_at desc`;

  const events = await sql<
    { id: string; actor: string; type: string; mandate_id: string | null; created_at: string }[]
  >`select id, actor, type, mandate_id, created_at
    from events where tab_id = ${tab.id}
    order by id desc limit 60`;

  const keys = await sql<
    { id: string; key_prefix: string; status: string; last_used_at: string | null }[]
  >`select id, key_prefix, status, last_used_at
    from agent_keys where tab_id = ${tab.id} order by created_at desc`;

  // The shell counter (OT-098): grown / worn / shed.
  const grown = children.filter((c) => c.status !== 'held' && c.status !== 'denied').length;
  const worn = children.filter((c) => c.status === 'consumed').length;
  const shed = children.filter((c) => SHED_STATES.has(c.status)).length;

  // A live (held/active/approved) mandate PARKS its amount - reserved, not
  // spent. Without this split the dashboard reads a reservation as a spend.
  const reservedMinor = children
    .filter((c) => ['held', 'active', 'approved'].includes(c.status))
    .reduce((sum, c) => sum + Number(c.amount_minor), 0);
  const spentMinor = Number(tab.total_minor) - Number(tab.remaining_minor) - reservedMinor;
  const total = Number(tab.total_minor);
  const spentPct = Math.min(100, Math.round((spentMinor / total) * 100));
  const reservedPct = Math.min(100 - spentPct, Math.round((reservedMinor / total) * 100));

  const consumedByMandate = new Map(receipts.map((r) => [r.mandate_id, r.id]));

  return (
    <main
      style={{ maxWidth: 760, margin: '3rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <p>
        <Link href="/dashboard">← Dashboard</Link>
      </p>

      <h1 style={{ marginBottom: '0.2rem' }}>Tab {shortId(tab.id)}</h1>
      <p style={{ marginTop: 0 }}>
        <StatusBadge status={tab.status} />{' '}
        <span style={{ color: '#666' }}>
          opened {new Date(tab.created_at).toLocaleDateString()}, expires{' '}
          {new Date(tab.expires_at).toLocaleString()}
        </span>
      </p>

      {/* --- spend progress + shell counter ---------------------------------- */}
      <section style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', margin: '1.2rem 0' }}>
        <div style={{ minWidth: 220, flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
            <span>
              spent <strong>{eur(spentMinor, tab.currency)}</strong>
              {reservedMinor > 0 && (
                <span style={{ color: '#b06f00' }}>
                  {' '}
                  · reserved <strong>{eur(reservedMinor, tab.currency)}</strong>
                </span>
              )}
            </span>
            <span>
              available <strong>{eur(tab.remaining_minor, tab.currency)}</strong> of{' '}
              {eur(tab.total_minor, tab.currency)}
            </span>
          </div>
          <div
            style={{
              background: '#eee',
              borderRadius: 4,
              height: 8,
              marginTop: 4,
              display: 'flex',
              overflow: 'hidden',
            }}
          >
            <div style={{ width: `${spentPct}%`, background: '#0a7d33', height: 8 }} />
            <div style={{ width: `${reservedPct}%`, background: '#b06f00', height: 8 }} />
          </div>
          {reservedMinor > 0 && (
            <div style={{ fontSize: '0.8rem', color: '#b06f00', marginTop: 2 }}>
              reserved means parked by a pending shell, not spent - it flows back if the purchase
              does not complete
            </div>
          )}
        </div>
        <div style={{ fontSize: '0.95rem', whiteSpace: 'nowrap' }} title="the molt cycle">
          🐚 shells: <strong>{grown}</strong> grown · <strong>{worn}</strong> worn ·{' '}
          <strong>{shed}</strong> shed
        </div>
      </section>

      {/* --- bounds ----------------------------------------------------------- */}
      {root && (
        <section>
          <h2 style={{ fontSize: '1.1rem' }}>The tab&apos;s limits</h2>
          <p style={{ color: '#444', marginTop: 0 }}>&ldquo;{root.task_declaration}&rdquo;</p>
          <ul style={{ marginTop: 0, color: '#444', fontSize: '0.95rem' }}>
            <li>
              per purchase max {eur(root.bounds.per_tx_max_minor ?? root.bounds.amount_minor)}
            </li>
            <li>
              merchant scope <code>{root.bounds.merchant_scope}</code>
              {root.bounds.mcc_allowlist.length > 0 && (
                <> · categories {root.bounds.mcc_allowlist.join(', ')}</>
              )}
            </li>
            <li>at most {root.bounds.velocity_per_hour} purchases per hour</li>
          </ul>
        </section>
      )}

      {/* --- mandate tree ------------------------------------------------------ */}
      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Mandates</h2>
        {root && (
          <p style={{ marginBottom: '0.3rem' }}>
            <StatusBadge status={root.status} /> root <code>{shortId(root.id)}</code> · signed by
            your passkey
          </p>
        )}
        {children.length === 0 ? (
          <p style={{ color: '#666' }}>No shells grown yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', paddingLeft: '1.2rem', borderLeft: '2px solid #eee' }}>
            {children.map((c) => (
              <li key={c.id} style={{ margin: '0.35rem 0', fontSize: '0.95rem' }}>
                <StatusBadge status={c.status} /> <code>{shortId(c.id)}</code>{' '}
                <strong>{eur(c.amount_minor, c.currency)}</strong> at{' '}
                {c.merchant_scope.replace('https://', '')}
                {consumedByMandate.has(c.id) && <span style={{ color: '#888' }}> · shed 🐚</span>}
                {c.reason && <div style={{ color: '#777', fontSize: '0.85rem' }}>{c.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- receipts ----------------------------------------------------------- */}
      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Receipts</h2>
        {receipts.length === 0 ? (
          <p style={{ color: '#666' }}>No purchases yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                  <th style={{ padding: '0.35rem 0.5rem 0.35rem 0' }}>When</th>
                  <th>Merchant</th>
                  <th>Amount</th>
                  <th>Rung · rail</th>
                  <th>Shell</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.35rem 0.5rem 0.35rem 0', whiteSpace: 'nowrap' }}>
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td>{r.merchant.replace('https://', '')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{eur(r.amount_minor, r.currency)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.rung} · {r.rail === 'card_stripe_test' ? 'card (test)' : 'USDC (testnet)'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: '#888' }}>shed 🐚</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <a href={`/api/tabs/${tab.id}/receipts/${r.id}`} download>
                        JSON
                      </a>{' '}
                      <span style={{ color: '#999', fontSize: '0.8rem' }}>
                        {r.ta_signature ? 'dual-signed' : 'unsigned'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {receipts.length > 0 && (
          <p style={{ color: '#777', fontSize: '0.85rem' }}>
            Verify any receipt offline: download the JSON, then{' '}
            <code>molt verify receipt.json</code>.
          </p>
        )}
      </section>

      {/* --- agent keys ----------------------------------------------------------- */}
      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Agent keys</h2>
        {keys.length === 0 ? (
          <p style={{ color: '#666' }}>No agent key yet. Create one to connect your agent.</p>
        ) : (
          <ul style={{ marginTop: 0, fontSize: '0.92rem' }}>
            {keys.map((k) => (
              <li key={k.id}>
                <code>{k.key_prefix}…</code> · {k.status}
                {k.last_used_at && (
                  <span style={{ color: '#888' }}>
                    {' '}
                    · last used {new Date(k.last_used_at).toLocaleString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {tab.status === 'active' && (
          <p>
            <KeyButton tabId={tab.id} /> <RevokeButton tabId={tab.id} />
          </p>
        )}
      </section>

      {/* --- event log ----------------------------------------------------------- */}
      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Event log</h2>
        <ul style={{ listStyle: 'none', padding: 0, fontSize: '0.88rem' }}>
          {events.map((e) => {
            const label = lifecycleLabel(e.type, e.actor);
            return (
              <li key={e.id} style={{ borderBottom: '1px solid #f2f2f2', padding: '0.3rem 0' }}>
                <span style={{ color: '#999', whiteSpace: 'nowrap' }}>
                  {new Date(e.created_at).toLocaleTimeString()}
                </span>{' '}
                {label ? <strong>{label}</strong> : e.type}
                <span style={{ color: '#999' }}>
                  {' '}
                  · {e.type} · {e.actor}
                  {e.mandate_id && <> · {shortId(e.mandate_id)}</>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
