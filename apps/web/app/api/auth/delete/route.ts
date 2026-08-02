import { NextResponse } from 'next/server';
import { deleteAccount } from '../../../../lib/account';
import { db } from '../../../../lib/db';
import { destroySession, getSessionUserId } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * GDPR account deletion (OT-082). Requires a live session plus the verbatim
 * confirmation sentence, so a stray API call or a CSRF-ish accident cannot
 * erase an account. Everything the user owns cascades; the events audit
 * trail stays, anonymized (FKs nulled by the deletion).
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== 'delete my account and all its data') {
    return NextResponse.json(
      { error: 'confirmation_required', expected: 'delete my account and all its data' },
      { status: 400 },
    );
  }

  // final event before the FKs anonymize: the deletion itself is auditable
  await db()`
    insert into events (user_id, actor, type, payload)
    values (${userId}, 'user', 'account.deletion_requested', ${db().json({})})`;

  const result = await deleteAccount(userId);
  await destroySession();
  return NextResponse.json({ ok: true, ...result });
}
