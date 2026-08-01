import { NextResponse } from 'next/server';
import { createSession, getRefreshUserId } from '../../../../lib/session';

export const runtime = 'nodejs';

/** Rotate the session: valid refresh token -> fresh access + refresh pair. */
export async function POST() {
  const userId = await getRefreshUserId();
  if (!userId) return NextResponse.json({ error: 'invalid_refresh' }, { status: 401 });
  await createSession(userId);
  return NextResponse.json({ ok: true });
}
