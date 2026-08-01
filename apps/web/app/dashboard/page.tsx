import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { getSessionUserId } from '../../lib/session';
import { LogoutButton } from './logout-button';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Placeholder dashboard: proves the session works. Real dashboard is Epic 7. */
export default async function DashboardPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect('/login');

  const [user] = await db()<{ email: string }[]>`select email from users where id = ${userId}`;
  if (!user) redirect('/login');

  return (
    <main
      style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1>Dashboard</h1>
      <p>
        Signed in as <strong>{user.email}</strong> via passkey.
      </p>
      <p>Tabs, mandate tree, and receipts land here in Epic 7.</p>
      <LogoutButton />
    </main>
  );
}
