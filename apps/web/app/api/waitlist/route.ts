import { NextResponse } from 'next/server';
import { db } from '../../../lib/db';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Waitlist capture for hosted live mode (OT-091). Idempotent and
 * enumeration-safe: the answer is upserted, the response never reveals
 * whether an email was already on the list.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    answer?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase() ?? '';
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }
  // Empty is null, not '': the form always sends the field, so a second
  // signup with the box left blank would otherwise coalesce over an answer
  // the same person gave the first time.
  const answer =
    typeof body?.answer === 'string' && body.answer.trim()
      ? body.answer.trim().slice(0, 500)
      : null;

  await db()`
    insert into waitlist (email, answer) values (${email}, ${answer})
    on conflict (email) do update set answer = coalesce(excluded.answer, waitlist.answer)`;
  return NextResponse.json({ ok: true });
}
