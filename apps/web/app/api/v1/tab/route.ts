import { NextResponse } from 'next/server';
import type { MandateBounds } from '@molt/protocol';
import { authenticateAgent } from '../../../../lib/agent-auth';
import { db } from '../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Whoami for agents: the tab this key is scoped to, with its budget.
 *
 * A key belongs to exactly one tab, so an agent never has to be told (or
 * guess) a tab id - and with several tabs configured, each server entry
 * answers for its own. Also the cheap way to report "how much is left?"
 * without listing receipts.
 */
export async function GET(req: Request) {
  const agent = await authenticateAgent(req);
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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

  // Live mandates park budget without having spent it.
  const [reserved] = await sql<{ minor: string }[]>`
    select coalesce(sum(amount_minor), 0) as minor from mandates
    where tab_id = ${tab.id} and kind = 'child'
      and status in ('held', 'active', 'approved')`;
  const reservedMinor = Number(reserved?.minor ?? 0);

  return NextResponse.json({
    tab_id: tab.id,
    status: tab.status,
    currency: tab.currency,
    total_minor: Number(tab.total_minor),
    available_minor: Number(tab.remaining_minor),
    reserved_minor: reservedMinor,
    spent_minor: Number(tab.total_minor) - Number(tab.remaining_minor) - reservedMinor,
    expires_at: tab.expires_at,
    ...(root
      ? { per_tx_max_minor: root.bounds.per_tx_max_minor, task_declaration: root.task_declaration }
      : {}),
  });
}
