import { NextResponse } from 'next/server';
import type { MandateBounds } from '@molt/protocol';
import { authenticateAgent } from '../../../../../lib/agent-auth';
import {
  cancelCardForMandate,
  deliverCardDetailsOnce,
  provisionCardForMandate,
} from '../../../../../lib/cards';
import { db } from '../../../../../lib/db';
import { expireHeldIfDue } from '../../../../../lib/mandates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mandate status for the agent - the polling target for held mandates. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req);
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Held past TTL? Auto-cancel and refund before answering (OT-024 AC).
  await expireHeldIfDue(params.id);

  const [mandate] = await db()<
    {
      id: string;
      tab_id: string;
      parent_id: string;
      status: string;
      bounds: MandateBounds;
      cart_hash: string | null;
      reason: string | null;
      expires_at: string;
    }[]
  >`select id, tab_id, parent_id, status, bounds, cart_hash, reason, expires_at
    from mandates where id = ${params.id} and kind = 'child'`;
  if (!mandate || mandate.tab_id !== agent.tab_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Approved (or active with a failed earlier delivery): hand over the card
  // details exactly once (OT-031).
  let card = null;
  if (mandate.status === 'approved' || mandate.status === 'active') {
    try {
      await provisionCardForMandate(mandate.id);
      card = await deliverCardDetailsOnce(mandate.id);
    } catch {
      // provisioning problems surface via events; polling again retries
    }
  }

  return NextResponse.json({
    id: mandate.id,
    parent_id: mandate.parent_id,
    status: mandate.status,
    bounds: mandate.bounds,
    cart_hash: mandate.cart_hash,
    reason: mandate.reason,
    expires_at: mandate.expires_at,
    // One-time delivery: non-null exactly once, on the first poll after approval.
    card,
  });
}

/**
 * Shed an unworn shell (OT-040/OT-052 AC: on failure, no charge attempted or
 * card immediately deactivated): the agent cancels its own unused child
 * mandate, the card dies, the reserved amount flows back into the tab.
 * Status becomes 'revoked' (the schema's terminal state for a mandate ended
 * before use); the event distinguishes the actor.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req);
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sql = db();
  const canceled = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; tab_id: string; amount_minor: string }[]>`
      update mandates set status = 'revoked'
      where id = ${params.id} and tab_id = ${agent.tab_id} and kind = 'child'
        and status in ('held', 'active', 'approved')
      returning id, tab_id, amount_minor`;
    if (!row) return null;
    await tx`
      update tabs set remaining_minor = remaining_minor + ${row.amount_minor}
      where id = ${row.tab_id}`;
    await tx`
      insert into events (tab_id, mandate_id, user_id, actor, type, payload)
      values (${row.tab_id}, ${row.id}, ${agent.user_id}, 'agent', 'mandate.canceled',
              ${tx.json({ refunded_minor: Number(row.amount_minor) })})`;
    return row;
  });

  if (!canceled) {
    // Either not ours, not a child, or already in a terminal state.
    const [existing] = await sql<{ status: string }[]>`
      select status from mandates
      where id = ${params.id} and tab_id = ${agent.tab_id} and kind = 'child'`;
    if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(
      { error: 'mandate_not_cancelable', status: existing.status },
      { status: 409 },
    );
  }

  // Outside the tx: the Stripe call must not hold DB locks.
  try {
    await cancelCardForMandate(canceled.id);
  } catch {
    // card cancellation is retried by the sweep; revocation itself already holds
  }

  return NextResponse.json({ ok: true, status: 'revoked' });
}
