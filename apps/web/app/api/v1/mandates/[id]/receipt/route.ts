import { NextResponse } from 'next/server';
import { authenticateAgent } from '../../../../../../lib/agent-auth';
import { db } from '../../../../../../lib/db';

export const runtime = 'nodejs';

interface ReceiptBody {
  rung: 'L0' | 'L1' | 'L2' | 'L3';
  rail: 'card_stripe_test' | 'usdc_x402_testnet';
  merchant: string;
  amount_minor: number;
  currency: string;
  idempotency_key: string;
  evidence?: Record<string, string>;
  agent_signature?: string;
}

const RUNGS = ['L0', 'L1', 'L2', 'L3'];
const RAILS = ['card_stripe_test', 'usdc_x402_testnet'];

/**
 * File a receipt for a consumed mandate (OT-025). Dual signing and the
 * verify CLI land in OT-060; the shape and constraints are enforced now:
 * amount within mandate, merchant matching scope, idempotency unique,
 * mandate consumed exactly once.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req);
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as ReceiptBody | null;
  if (
    !body ||
    !RUNGS.includes(body.rung) ||
    !RAILS.includes(body.rail) ||
    !body.merchant ||
    !Number.isSafeInteger(body.amount_minor) ||
    body.amount_minor <= 0 ||
    !body.idempotency_key
  ) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const sql = db();
  const [mandate] = await sql<
    {
      id: string;
      tab_id: string;
      parent_id: string;
      status: string;
      amount_minor: string;
      currency: string;
      merchant_scope: string;
    }[]
  >`select id, tab_id, parent_id, status, amount_minor, currency, merchant_scope
    from mandates where id = ${params.id} and kind = 'child'`;
  if (!mandate || mandate.tab_id !== agent.tab_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (mandate.status !== 'active' && mandate.status !== 'approved') {
    return NextResponse.json(
      { error: 'mandate_not_usable', status: mandate.status },
      { status: 409 },
    );
  }
  if (body.amount_minor > Number(mandate.amount_minor)) {
    return NextResponse.json({ error: 'amount_exceeds_mandate' }, { status: 422 });
  }
  if (body.merchant !== mandate.merchant_scope) {
    return NextResponse.json({ error: 'merchant_outside_mandate_scope' }, { status: 422 });
  }
  if (body.currency !== mandate.currency) {
    return NextResponse.json({ error: 'currency_mismatch' }, { status: 422 });
  }

  try {
    const [receipt] = await sql.begin(async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        insert into receipts
          (tab_id, mandate_id, rung, rail, merchant, amount_minor, currency,
           evidence, idempotency_key, mandate_chain, agent_signature)
        values
          (${mandate.tab_id}, ${mandate.id}, ${body.rung}, ${body.rail},
           ${body.merchant}, ${body.amount_minor}, ${body.currency},
           ${tx.json((body.evidence ?? {}) as never)}, ${body.idempotency_key},
           ${tx.json([mandate.parent_id, mandate.id])}, ${body.agent_signature ?? null})
        returning id`;
      await tx`update mandates set status = 'consumed' where id = ${mandate.id}`;
      await tx`
        insert into events (tab_id, mandate_id, user_id, actor, type, payload)
        values (${mandate.tab_id}, ${mandate.id}, ${agent.user_id}, 'agent', 'receipt.filed',
                ${tx.json({ receipt_id: r?.id, rung: body.rung, rail: body.rail, amount_minor: body.amount_minor })})`;
      return [r];
    });
    return NextResponse.json({ ok: true, receipt_id: receipt?.id }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    if (message.includes('idempotency_key')) {
      return NextResponse.json({ error: 'duplicate_idempotency_key' }, { status: 409 });
    }
    return NextResponse.json({ error: 'receipt_failed' }, { status: 500 });
  }
}
