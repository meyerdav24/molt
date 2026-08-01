import { cancelCardForMandate } from './cards';
import { db } from './db';

/**
 * Lazy expiry (OT-024/OT-031): an unused child mandate past its TTL flips to
 * expired on first read - held, active, and approved alike. The reserved
 * amount flows back into the tab budget, and if a card was already grown for
 * it, the card is cancelled (shed unworn). Same refund on deny.
 */
export async function expireHeldIfDue(mandateId: string): Promise<boolean> {
  const sql = db();
  const expired = await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; tab_id: string; amount_minor: string }[]>`
      update mandates set status = 'expired'
      where id = ${mandateId} and status in ('held', 'active', 'approved')
        and expires_at <= now()
      returning id, tab_id, amount_minor`;
    if (!row) return null;
    await tx`
      update tabs set remaining_minor = remaining_minor + ${row.amount_minor}
      where id = ${row.tab_id}`;
    await tx`
      insert into events (tab_id, mandate_id, actor, type, payload)
      values (${row.tab_id}, ${row.id}, 'ta', 'mandate.expired',
              ${tx.json({ refunded_minor: Number(row.amount_minor) })})`;
    return row;
  });
  if (!expired) return false;
  // outside the tx: Stripe call must not hold DB locks
  try {
    await cancelCardForMandate(mandateId);
  } catch {
    // card cancellation is retried by the sweep; expiry itself already holds
  }
  return true;
}
