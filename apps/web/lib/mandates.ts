import { db } from './db';

/**
 * Lazy expiry (OT-024 AC: expired step-up requests auto-cancel): a held
 * mandate past its TTL flips to expired on first read, and its reserved
 * amount flows back into the tab budget. Same refund on deny.
 */
export async function expireHeldIfDue(mandateId: string): Promise<boolean> {
  const sql = db();
  return await sql.begin(async (tx) => {
    const [expired] = await tx<{ id: string; tab_id: string; amount_minor: string }[]>`
      update mandates set status = 'expired'
      where id = ${mandateId} and status = 'held' and expires_at <= now()
      returning id, tab_id, amount_minor`;
    if (!expired) return false;
    await tx`
      update tabs set remaining_minor = remaining_minor + ${expired.amount_minor}
      where id = ${expired.tab_id}`;
    await tx`
      insert into events (tab_id, mandate_id, actor, type, payload)
      values (${expired.tab_id}, ${expired.id}, 'ta', 'mandate.expired',
              ${tx.json({ refunded_minor: Number(expired.amount_minor) })})`;
    return true;
  });
}
