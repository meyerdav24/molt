/**
 * Privacy policy (OT-082). Plain language, no legalese theater: what is
 * stored, where, for how long, and how deletion works. Reviewed alongside
 * the disclaimers by a lawyer-adjacent reader before launch.
 */
export const metadata = { title: 'Privacy - Molt' };

export default function PrivacyPage() {
  return (
    <main
      style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1>Privacy</h1>
      <p>
        Molt is test-mode infrastructure. No real money moves, and we collect the minimum needed to
        run a tab.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>What we store</h2>
      <ul>
        <li>
          <strong>Account:</strong> your email address and your passkey&apos;s public key. We never
          see the passkey itself; it stays on your device.
        </li>
        <li>
          <strong>Tabs and mandates:</strong> the limits you sign (budget, expiry, merchant scope,
          categories) and the task you declare.
        </li>
        <li>
          <strong>Receipts:</strong> merchant, amount, timestamps, signatures, and the hashes of
          purchase evidence. The evidence itself (screenshots, page snapshots) is created and kept
          by your agent on your machine; only hashes reach us.
        </li>
        <li>
          <strong>Event log:</strong> an append-only record of what happened on your tabs (who
          approved, what was refused, when).
        </li>
        <li>
          <strong>Cards:</strong> Stripe card identifiers only. Card numbers are never stored or
          logged by Molt.
        </li>
      </ul>

      <h2 style={{ fontSize: '1.1rem' }}>Where it lives</h2>
      <p>
        The database is hosted with Supabase in the EU (Frankfurt). Payments run through Stripe in
        test mode; step-up emails go out via Resend. Those processors keep their own records under
        their own policies. There are no third-party analytics and no advertising trackers.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>How long, and how to delete</h2>
      <p>
        Everything is kept while your account exists. Deleting your account (dashboard, or on
        request to the address below) removes your tabs, mandates, receipts, agent keys and passkey
        records immediately. The event log is kept as an anonymized audit trail: the rows stay,
        every link to you is removed.
      </p>

      <h2 style={{ fontSize: '1.1rem' }}>Contact</h2>
      <p>
        Data questions and deletion requests: <code>privacy@moltprotocol.dev</code>
      </p>
    </main>
  );
}
