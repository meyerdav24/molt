import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { getSessionUserId } from '../../lib/session';
import { LogoutButton } from './logout-button';
import { RevokeButton } from './revoke-button';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minimal dashboard: tab list + entry to the ceremony. Full version is Epic 7. */
export default async function DashboardPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect('/login');

  const sql = db();
  const [user] = await sql<{ email: string }[]>`select email from users where id = ${userId}`;
  if (!user) redirect('/login');

  const tabs = await sql<
    {
      id: string;
      status: string;
      total_minor: string;
      remaining_minor: string;
      expires_at: string;
    }[]
  >`select id, status, total_minor, remaining_minor, expires_at
    from tabs where user_id = ${userId} order by created_at desc`;

  const eur = (minor: string) => `€${(Number(minor) / 100).toFixed(2)}`;

  return (
    <main
      style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1>Dashboard</h1>
      <p>
        Signed in as <strong>{user.email}</strong> via passkey.
      </p>

      <p>
        <Link href="/tabs/new">Open a tab</Link>
      </p>

      {tabs.length === 0 ? (
        <p>No tabs yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th style={{ padding: '0.4rem 0' }}>Status</th>
              <th>Remaining</th>
              <th>Total</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tabs.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.4rem 0' }}>{t.status}</td>
                <td>{eur(t.remaining_minor)}</td>
                <td>{eur(t.total_minor)}</td>
                <td>{new Date(t.expires_at).toLocaleDateString()}</td>
                <td>{t.status === 'active' && <RevokeButton tabId={t.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: '2rem' }}>
        <LogoutButton />
      </p>
    </main>
  );
}
