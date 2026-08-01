import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { getSessionUserId } from '../../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Revoke a tab: kills the root mandate and every outstanding child.
 * Deliberately requires only a session, not a passkey assertion —
 * revocation narrows authority to zero; only expansions need a signature.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sql = db();
  const revoked = await sql.begin(async (tx) => {
    const [tab] = await tx<{ id: string }[]>`
      update tabs set status = 'revoked'
      where id = ${params.id} and user_id = ${userId} and status = 'active'
      returning id`;
    if (!tab) return null;

    await tx`
      update mandates set status = 'revoked'
      where tab_id = ${tab.id} and status in ('active', 'pending', 'held', 'approved')`;

    await tx`
      insert into events (tab_id, user_id, actor, type, payload)
      values (${tab.id}, ${userId}, 'user', 'tab.revoked', '{}')`;
    return tab.id;
  });

  if (!revoked) return NextResponse.json({ error: 'not_found_or_not_active' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
