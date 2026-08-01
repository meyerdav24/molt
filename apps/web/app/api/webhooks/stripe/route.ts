import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { cancelCardForMandate } from '../../../../lib/cards';
import { db } from '../../../../lib/db';
import { stripe } from '../../../../lib/stripe';

export const runtime = 'nodejs';

/**
 * Stripe Issuing webhooks (OT-032).
 *
 * Real-time authorization (issuing_authorization.request) is the second
 * enforcement layer beyond the card's own spending controls: approve only
 * if an active/approved child mandate matches the card and the amount fits.
 * Defense in depth - a TA bug cannot widen the card limits, and a card bug
 * cannot bypass the mandate check.
 *
 * issuing_transaction.created settles the loop: receipt status, mandate
 * consumed, card cancelled (the shell is shed).
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook_secret_missing' }, { status: 500 });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing_signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await req.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  const sql = db();

  // Idempotent retries: each event id is processed once.
  const [seen] = await sql<{ id: string }[]>`
    select id from events where type = 'stripe.webhook' and payload ->> 'event_id' = ${event.id}`;
  if (seen) return NextResponse.json({ received: true, duplicate: true });

  switch (event.type) {
    case 'issuing_authorization.request': {
      const auth = event.data.object as Stripe.Issuing.Authorization;
      const cardId = auth.card.id;
      const amount = Math.abs(auth.pending_request?.amount ?? auth.amount);

      const [mandate] = await sql<
        { id: string; tab_id: string; status: string; amount_minor: string; expires_at: string }[]
      >`select m.id, m.tab_id, m.status, m.amount_minor, m.expires_at
        from mandates m join cards c on c.mandate_id = m.id
        where c.stripe_card_id = ${cardId}`;

      const usable =
        !!mandate &&
        (mandate.status === 'active' || mandate.status === 'approved') &&
        new Date(mandate.expires_at).getTime() > Date.now() &&
        amount <= Number(mandate.amount_minor);

      await sql`
        insert into events (tab_id, mandate_id, actor, type, payload)
        values (${mandate?.tab_id ?? null}, ${mandate?.id ?? null}, 'stripe_webhook', 'stripe.webhook',
                ${sql.json({
                  event_id: event.id,
                  event_type: event.type,
                  authorization_id: auth.id,
                  amount_minor: amount,
                  approved: usable,
                  reason: usable
                    ? 'active matching child mandate'
                    : mandate
                      ? `mandate not usable (${mandate.status})`
                      : 'no mandate for card',
                })})`;

      // Synchronous decision: this response approves or declines.
      return NextResponse.json(
        { approved: usable },
        { headers: { 'stripe-version': event.api_version ?? '' } },
      );
    }

    case 'issuing_authorization.created': {
      const auth = event.data.object as Stripe.Issuing.Authorization;
      const [mandate] = await sql<{ id: string; tab_id: string }[]>`
        select m.id, m.tab_id from mandates m
        join cards c on c.mandate_id = m.id
        where c.stripe_card_id = ${auth.card.id}`;
      await sql`
        insert into events (tab_id, mandate_id, actor, type, payload)
        values (${mandate?.tab_id ?? null}, ${mandate?.id ?? null}, 'stripe_webhook', 'stripe.webhook',
                ${sql.json({
                  event_id: event.id,
                  event_type: event.type,
                  authorization_id: auth.id,
                  approved: auth.approved,
                  amount_minor: Math.abs(auth.amount),
                })})`;
      return NextResponse.json({ received: true });
    }

    case 'issuing_transaction.created': {
      const txn = event.data.object as Stripe.Issuing.Transaction;
      const cardId = typeof txn.card === 'string' ? txn.card : txn.card.id;
      const [mandate] = await sql<{ id: string; tab_id: string }[]>`
        select m.id, m.tab_id from mandates m
        join cards c on c.mandate_id = m.id
        where c.stripe_card_id = ${cardId}`;

      if (mandate) {
        // Link settlement to the receipt; the agent files receipts itself,
        // the webhook upgrades them to settled.
        await sql`
          update receipts set status = 'settled'
          where mandate_id = ${mandate.id} and status = 'pending'`;
        // Worn once: the card dies with the first settled transaction.
        try {
          await cancelCardForMandate(mandate.id);
        } catch {
          // retried on expiry sweep
        }
      }

      await sql`
        insert into events (tab_id, mandate_id, actor, type, payload)
        values (${mandate?.tab_id ?? null}, ${mandate?.id ?? null}, 'stripe_webhook', 'stripe.webhook',
                ${sql.json({
                  event_id: event.id,
                  event_type: event.type,
                  transaction_id: txn.id,
                  amount_minor: Math.abs(txn.amount),
                })})`;
      return NextResponse.json({ received: true });
    }

    default: {
      await sql`
        insert into events (actor, type, payload)
        values ('stripe_webhook', 'stripe.webhook',
                ${sql.json({ event_id: event.id, event_type: event.type, ignored: true })})`;
      return NextResponse.json({ received: true, ignored: true });
    }
  }
}
