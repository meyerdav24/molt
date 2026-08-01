import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { getSessionUserId } from '../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const [user] = await db()<{ id: string; email: string }[]>`
    select id, email from users where id = ${userId}`;
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  return NextResponse.json({ id: user.id, email: user.email });
}
