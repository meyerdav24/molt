import { NextResponse } from 'next/server';
import { authenticateAgent } from '../../../../../../lib/agent-auth';
import { db } from '../../../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List receipts for a tab (OT-025). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req);
  if (!agent || agent.tab_id !== params.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const receipts = await db()<
    {
      id: string;
      mandate_id: string;
      rung: string;
      rail: string;
      merchant: string;
      amount_minor: string;
      currency: string;
      evidence: Record<string, string>;
      idempotency_key: string;
      mandate_chain: string[];
      status: string;
      created_at: string;
    }[]
  >`select id, mandate_id, rung, rail, merchant, amount_minor, currency,
           evidence, idempotency_key, mandate_chain, status, created_at
    from receipts where tab_id = ${agent.tab_id} order by created_at desc`;

  return NextResponse.json({
    receipts: receipts.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) })),
  });
}
