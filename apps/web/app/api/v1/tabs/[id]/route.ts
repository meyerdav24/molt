import { NextResponse } from 'next/server';
import type { MandateBounds } from '@molt/protocol';
import { authenticateAgent } from '../../../../../lib/agent-auth';
import { db } from '../../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tab status for the agent: bounds, budget, expiry. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req);
  if (!agent || agent.tab_id !== params.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sql = db();
  const [tab] = await sql<
    {
      id: string;
      status: string;
      currency: string;
      total_minor: string;
      remaining_minor: string;
      expires_at: string;
    }[]
  >`select id, status, currency, total_minor, remaining_minor, expires_at
    from tabs where id = ${agent.tab_id}`;
  if (!tab) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [root] = await sql<{ bounds: MandateBounds; task_declaration: string }[]>`
    select bounds, task_declaration from mandates
    where tab_id = ${tab.id} and kind = 'root'`;

  return NextResponse.json({
    id: tab.id,
    status: tab.status,
    currency: tab.currency,
    total_minor: Number(tab.total_minor),
    remaining_minor: Number(tab.remaining_minor),
    expires_at: tab.expires_at,
    per_tx_max_minor: root?.bounds.per_tx_max_minor,
    mcc_allowlist: root?.bounds.mcc_allowlist,
    velocity_per_hour: root?.bounds.velocity_per_hour,
    task_declaration: root?.task_declaration,
  });
}
