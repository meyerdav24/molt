/**
 * Account deletion (OT-082): the cascade that actually cascades.
 *
 * Deleting the user row removes tabs, mandates, cards, receipts, agent keys
 * and passkey credentials via FK cascades. The events audit log is the one
 * deliberate exception: rows stay, but every FK to the user anonymizes to
 * NULL (see the events_anonymization migration) - the trail keeps its shape
 * without naming anyone. Stripe-side, every still-active card is canceled
 * first; the test-mode cardholder object remains at Stripe (processors keep
 * their own books) and is covered by the privacy policy.
 *
 * Evidence artifacts (DOM snapshots, screenshots) never reach the TA - only
 * their hashes do - so there is nothing server-side to purge beyond the rows.
 */
import { db } from './db';
import { stripe } from './stripe';

export interface DeletionResult {
  tabs_deleted: number;
  cards_canceled: number;
}

export async function deleteAccount(userId: string): Promise<DeletionResult> {
  const sql = db();

  // shed every shell that is still alive before the rows disappear
  const activeCards = await sql<{ stripe_card_id: string }[]>`
    select c.stripe_card_id from cards c
    join mandates m on m.id = c.mandate_id
    join tabs t on t.id = m.tab_id
    where t.user_id = ${userId} and c.status = 'active'`;
  let canceled = 0;
  for (const { stripe_card_id } of activeCards) {
    try {
      await stripe().issuing.cards.update(stripe_card_id, { status: 'canceled' });
      canceled++;
    } catch {
      // an already-canceled card is fine; the delete below proceeds either way
    }
  }

  const tabs = await sql<{ id: string }[]>`
    delete from tabs where user_id = ${userId} returning id`;
  await sql`delete from users where id = ${userId}`;

  return { tabs_deleted: tabs.length, cards_canceled: canceled };
}
