import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  evaluatePolicy,
  mintChildMandate,
  type MandateBounds,
  type StepUpPolicy,
} from '@molt/protocol';
import { authenticateAgent } from '../../../../../../lib/agent-auth';
import { deliverCardDetailsOnce, provisionCardForMandate } from '../../../../../../lib/cards';
import { db } from '../../../../../../lib/db';
import { sendStepUpEmail } from '../../../../../../lib/email';
import { createStepUpToken } from '../../../../../../lib/step-up';

export const runtime = 'nodejs';

interface MandateRequestBody {
  merchant_origin: string;
  amount_minor: number;
  cart_hash: string;
  reason: string;
  mcc?: string;
  /** Human-readable cart lines ("2× USB-C Hub"), shown on the step-up page. */
  items_summary?: string[];
}

/**
 * Request a child mandate (OT-025, wiring OT-022 + OT-023).
 *
 * Order of authority: the policy engine decides how to treat the request
 * (auto-approve / notify / hold for tap / block), the narrowing engine
 * decides whether it is allowed at all, and the mint_child_mandate() SQL
 * function enforces budget + velocity atomically. Every decision lands in
 * the events audit log with full reasoning.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req);
  if (!agent || agent.tab_id !== params.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as MandateRequestBody | null;
  if (!body?.merchant_origin || typeof body.amount_minor !== 'number') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  // Display-only, agent-supplied: bound it before it touches the event log.
  body.items_summary = Array.isArray(body.items_summary)
    ? body.items_summary.slice(0, 20).map((s) => String(s).slice(0, 120))
    : [];

  const sql = db();
  const [tab] = await sql<
    { id: string; user_id: string; status: string; remaining_minor: string }[]
  >`select id, user_id, status, remaining_minor from tabs where id = ${agent.tab_id}`;
  if (!tab) return NextResponse.json({ error: 'tab_not_found' }, { status: 404 });
  if (tab.status !== 'active') {
    return NextResponse.json({ error: 'tab_not_active', status: tab.status }, { status: 409 });
  }

  const [root] = await sql<
    { id: string; status: string; bounds: MandateBounds; step_up_policy: StepUpPolicy }[]
  >`select id, status, bounds, step_up_policy
    from mandates where tab_id = ${tab.id} and kind = 'root'`;
  if (!root) return NextResponse.json({ error: 'root_mandate_missing' }, { status: 500 });

  // Context for policy + engine: merchants seen, purchase history, mint times.
  const knownMerchants = await sql<{ merchant: string }[]>`
    select distinct merchant from receipts where tab_id = ${tab.id}`;
  const recentAmounts = await sql<{ amount_minor: string }[]>`
    select amount_minor from receipts where tab_id = ${tab.id}
    order by created_at desc limit 20`;
  const recentMints = await sql<{ created_at: string }[]>`
    select created_at from mandates
    where parent_id = ${root.id} and created_at > now() - interval '1 hour'`;

  const now = new Date();
  const mintTimes = recentMints.map((r) => new Date(r.created_at).toISOString());

  const decision = evaluatePolicy(
    {
      policy: root.step_up_policy,
      bounds: root.bounds,
      known_merchants: knownMerchants.map((r) => r.merchant),
      recent_amounts_minor: recentAmounts.map((r) => Number(r.amount_minor)),
      recent_mint_times: mintTimes,
      now,
    },
    {
      merchant_origin: body.merchant_origin,
      amount_minor: body.amount_minor,
      ...(body.mcc !== undefined ? { mcc: body.mcc } : {}),
    },
  );

  await sql`
    insert into events (tab_id, mandate_id, user_id, actor, type, payload)
    values (${tab.id}, ${root.id}, ${tab.user_id}, 'ta', 'policy.decision',
            ${sql.json(JSON.parse(JSON.stringify({ request: body, outcome: decision.outcome, triggers: decision.triggers })))})`;

  if (decision.outcome === 'block') {
    return NextResponse.json(
      { error: 'blocked_by_policy', outcome: decision.outcome, triggers: decision.triggers },
      { status: 403 },
    );
  }

  const engine = mintChildMandate(
    {
      tab_id: tab.id,
      parent_id: root.id,
      bounds: root.bounds,
      status: root.status,
      remaining_minor: Number(tab.remaining_minor),
      recent_mint_times: mintTimes,
    },
    {
      merchant_origin: body.merchant_origin,
      amount_minor: body.amount_minor,
      cart_hash: body.cart_hash ?? '',
      reason: body.reason ?? '',
      ...(body.mcc !== undefined ? { mcc: body.mcc } : {}),
    },
    { now, id: randomUUID() },
  );

  if (!engine.ok) {
    await sql`
      insert into events (tab_id, mandate_id, user_id, actor, type, payload)
      values (${tab.id}, ${root.id}, ${tab.user_id}, 'ta', 'mandate.refused',
              ${sql.json(JSON.parse(JSON.stringify({ request: body, violations: engine.violations })))})`;
    return NextResponse.json(
      { error: 'narrowing_violation', violations: engine.violations },
      { status: 422 },
    );
  }

  // Atomic layer: budget decrement + velocity re-check + insert, one transaction.
  let minted: { id: string };
  try {
    const [row] = await sql<{ id: string }[]>`
      select (public.mint_child_mandate(
        ${tab.id}, ${root.id}, ${engine.child.bounds.amount_minor},
        ${engine.child.bounds.currency}, ${engine.child.bounds.merchant_scope},
        ${engine.child.cart_hash}, ${engine.child.reason},
        ${sql.json(engine.child.bounds as never)}, ${engine.child.bounds.expires_at},
        ${engine.child.id}
      )).id as id`;
    if (!row) throw new Error('mint returned nothing');
    minted = row;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'mint failed';
    const status = message.includes('velocity') ? 429 : message.includes('budget') ? 409 : 500;
    return NextResponse.json({ error: 'mint_failed', detail: message }, { status });
  }

  const finalStatus = decision.outcome === 'hold_for_tap' ? 'held' : 'active';
  await sql`update mandates set status = ${finalStatus} where id = ${minted.id}`;
  await sql`
    insert into events (tab_id, mandate_id, user_id, actor, type, payload)
    values (${tab.id}, ${minted.id}, ${tab.user_id}, 'ta',
            ${finalStatus === 'held' ? 'mandate.held' : 'mandate.activated'},
            ${sql.json(JSON.parse(JSON.stringify({ triggers: decision.triggers, outcome: decision.outcome, items_summary: body.items_summary })))})`;

  if (finalStatus === 'held') {
    // The Tap (OT-024): email the user; the link opens the step-up page,
    // approval there requires a passkey assertion.
    const [owner] = await sql<{ email: string }[]>`
      select email from users where id = ${tab.user_id}`;
    const token = await createStepUpToken(minted.id);
    const url = `${process.env.MOLT_PUBLIC_URL ?? 'http://localhost:3000'}/step-up/${token}`;
    const { sent } = await sendStepUpEmail({
      to: owner?.email ?? '',
      merchant: body.merchant_origin,
      amount_minor: body.amount_minor,
      currency: engine.child.bounds.currency,
      reason: body.reason ?? '',
      triggers: decision.triggers.map((t) => t.reason),
      url,
    });
    await sql`
      insert into events (tab_id, mandate_id, user_id, actor, type, payload)
      values (${tab.id}, ${minted.id}, ${tab.user_id}, 'ta', 'stepup.requested',
              ${sql.json({ email_sent: sent })})`;

    return NextResponse.json(
      {
        status: 'held',
        mandate_id: minted.id,
        parent_id: root.id,
        message: 'user approval requested via email; poll GET /v1/mandates/:id until approved',
        triggers: decision.triggers,
      },
      { status: 202 },
    );
  }

  // Grow the shell (OT-031): scoped single-use card, details delivered once.
  let card = null;
  try {
    await provisionCardForMandate(minted.id);
    card = await deliverCardDetailsOnce(minted.id);
  } catch (e) {
    // Mandate stays active; agent can retry via GET /v1/mandates/:id.
    await sql`
      insert into events (tab_id, mandate_id, user_id, actor, type, payload)
      values (${tab.id}, ${minted.id}, ${tab.user_id}, 'ta', 'card.provision_failed',
              ${sql.json({ detail: e instanceof Error ? e.message : 'unknown' })})`;
  }

  return NextResponse.json(
    {
      status: 'active',
      mandate_id: minted.id,
      parent_id: root.id,
      bounds: engine.child.bounds,
      // One-time delivery. Not stored, not logged, not retrievable again.
      card,
      notified: decision.outcome === 'notify' ? decision.triggers : undefined,
    },
    { status: 201 },
  );
}
