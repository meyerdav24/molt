/**
 * Child mandate -> single-use scoped virtual card (OT-031): the shell.
 *
 * spending_controls mirror the mandate: per-authorization limit = exact
 * mandate amount, allowed categories from the mandate MCC list. Card details
 * (number, cvc, expiry) are fetched from Stripe at delivery time, handed to
 * the agent exactly once, and never stored or logged - the DB holds only the
 * Stripe card ID and the delivery timestamp.
 */
import type { MandateBounds } from '@molt/protocol';
import { db } from './db';
import { stripeCategoriesForMccs } from './mcc';
import { ensureCardholder } from './cardholder';
import { stripe } from './stripe';

export interface DeliveredCard {
  card_id: string;
  number: string;
  cvc: string;
  exp_month: number;
  exp_year: number;
  brand: string;
}

/** Create the card for an active/approved child mandate. Idempotent per mandate. */
export async function provisionCardForMandate(mandateId: string): Promise<string> {
  const sql = db();
  const [existing] = await sql<{ stripe_card_id: string }[]>`
    select stripe_card_id from cards where mandate_id = ${mandateId}`;
  if (existing) return existing.stripe_card_id;

  const [m] = await sql<
    {
      id: string;
      tab_id: string;
      status: string;
      amount_minor: string;
      currency: string;
      bounds: MandateBounds;
      user_id: string;
    }[]
  >`select m.id, m.tab_id, m.status, m.amount_minor, m.currency, m.bounds, t.user_id
    from mandates m join tabs t on t.id = m.tab_id
    where m.id = ${mandateId} and m.kind = 'child'`;
  if (!m) throw new Error('mandate not found');
  if (m.status !== 'active' && m.status !== 'approved') {
    throw new Error(`mandate not usable (${m.status})`);
  }

  const cardholderId = await ensureCardholder(m.user_id);
  const categories = stripeCategoriesForMccs(m.bounds.mcc_allowlist);

  const card = await stripe().issuing.cards.create(
    {
      cardholder: cardholderId,
      currency: m.currency.toLowerCase(),
      type: 'virtual',
      status: 'active',
      spending_controls: {
        spending_limits: [
          { amount: Number(m.amount_minor), interval: 'per_authorization' },
          // hard ceiling across the card's life: one mandate amount, total
          { amount: Number(m.amount_minor), interval: 'all_time' },
        ],
        ...(categories.length > 0 ? { allowed_categories: categories as never } : {}),
      },
      metadata: { molt_mandate_id: m.id, molt_tab_id: m.tab_id },
    },
    { idempotencyKey: `molt-card-${m.id}` },
  );

  await sql`
    insert into cards (mandate_id, stripe_card_id) values (${m.id}, ${card.id})
    on conflict (mandate_id) do nothing`;
  await sql`
    insert into events (tab_id, mandate_id, user_id, actor, type, payload)
    values (${m.tab_id}, ${m.id}, ${m.user_id}, 'ta', 'card.provisioned',
            ${sql.json({ stripe_card_id: card.id, amount_minor: Number(m.amount_minor) })})`;
  return card.id;
}

/**
 * One-time delivery of card details. Returns null if they were already
 * delivered - there is no second look, by design.
 */
export async function deliverCardDetailsOnce(mandateId: string): Promise<DeliveredCard | null> {
  const sql = db();
  const [row] = await sql<{ id: string; stripe_card_id: string }[]>`
    update cards set details_delivered_at = now()
    where mandate_id = ${mandateId} and details_delivered_at is null
    returning id, stripe_card_id`;
  if (!row) return null;

  const card = await stripe().issuing.cards.retrieve(row.stripe_card_id, {
    expand: ['number', 'cvc'],
  });
  return {
    card_id: card.id,
    number: card.number ?? '',
    cvc: card.cvc ?? '',
    exp_month: card.exp_month,
    exp_year: card.exp_year,
    brand: card.brand,
  };
}

/** Shed the shell: cancel the card. Used after settlement and on expiry. */
export async function cancelCardForMandate(mandateId: string): Promise<void> {
  const sql = db();
  const [row] = await sql<{ stripe_card_id: string; status: string }[]>`
    select stripe_card_id, status from cards where mandate_id = ${mandateId}`;
  if (!row || row.status === 'deactivated') return;
  await stripe().issuing.cards.update(row.stripe_card_id, { status: 'canceled' });
  await sql`
    update cards set status = 'deactivated', deactivated_at = now()
    where mandate_id = ${mandateId}`;
}
