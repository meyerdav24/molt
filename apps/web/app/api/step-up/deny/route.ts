import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { verifyStepUpToken } from '../../../../lib/step-up';

export const runtime = 'nodejs';

/**
 * Deny a held mandate: one tap, no passkey needed (denying narrows authority
 * to zero). Cancels the child mandate and returns the reserved budget.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  const mandateId = body?.token ? await verifyStepUpToken(body.token) : null;
  if (!mandateId) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });

  const sql = db();
  const denied = await sql.begin(async (tx) => {
    const [m] = await tx<{ id: string; tab_id: string; amount_minor: string; user_id: string }[]>`
      update mandates set status = 'denied'
      where id = ${mandateId} and kind = 'child' and status = 'held'
      returning id, tab_id, amount_minor,
        (select user_id from tabs where id = mandates.tab_id) as user_id`;
    if (!m) return false;
    await tx`
      update tabs set remaining_minor = remaining_minor + ${m.amount_minor}
      where id = ${m.tab_id}`;
    await tx`
      insert into events (tab_id, mandate_id, user_id, actor, type, payload)
      values (${m.tab_id}, ${m.id}, ${m.user_id}, 'user', 'mandate.denied',
              ${tx.json({ refunded_minor: Number(m.amount_minor) })})`;
    return true;
  });

  if (!denied) return NextResponse.json({ error: 'not_held' }, { status: 409 });
  return NextResponse.json({ ok: true, status: 'denied' });
}
