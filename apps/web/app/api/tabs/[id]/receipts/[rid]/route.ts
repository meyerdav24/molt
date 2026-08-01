import { NextResponse } from 'next/server';
import { db } from '../../../../../../lib/db';
import { getSessionUserId } from '../../../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Download one receipt as the SignedReceipt document (OT-070): exactly the
 * shape `molt verify receipt.json` checks offline - body, both signatures,
 * both public keys.
 */
export async function GET(_req: Request, { params }: { params: { id: string; rid: string } }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const [r] = await db()<
    {
      id: string;
      tab_id: string;
      mandate_id: string;
      rung: string;
      rail: string;
      merchant: string;
      amount_minor: string;
      currency: string;
      evidence: Record<string, string>;
      idempotency_key: string;
      mandate_chain: string[];
      agent_signature: string | null;
      ta_signature: string | null;
      agent_public_key: string | null;
      ta_public_key: string | null;
      created_at: string;
    }[]
  >`select r.id, r.tab_id, r.mandate_id, r.rung, r.rail, r.merchant, r.amount_minor,
           r.currency, r.evidence, r.idempotency_key, r.mandate_chain,
           r.agent_signature, r.ta_signature, r.agent_public_key, r.ta_public_key,
           r.created_at
    from receipts r join tabs t on t.id = r.tab_id
    where r.id = ${params.rid} and r.tab_id = ${params.id} and t.user_id = ${userId}`;
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const receipt = {
    id: r.id,
    tab_id: r.tab_id,
    mandate_id: r.mandate_id,
    rung: r.rung,
    rail: r.rail,
    merchant: r.merchant,
    amount_minor: Number(r.amount_minor),
    currency: r.currency,
    evidence: r.evidence,
    idempotency_key: r.idempotency_key,
    mandate_chain: r.mandate_chain,
    created_at: new Date(r.created_at).toISOString(),
    agent_signature: r.agent_signature,
    ta_signature: r.ta_signature,
    agent_public_key: r.agent_public_key,
    ta_public_key: r.ta_public_key,
  };

  return new NextResponse(`${JSON.stringify(receipt, null, 2)}\n`, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="receipt-${r.id.slice(0, 8)}.json"`,
    },
  });
}
