import { NextResponse } from 'next/server';
import type { MandateBounds } from '@molt/protocol';
import { authenticateAgent } from '../../../../../lib/agent-auth';
import { db } from '../../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mandate status for the agent - the polling target for held mandates. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(req);
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [mandate] = await db()<
    {
      id: string;
      tab_id: string;
      status: string;
      bounds: MandateBounds;
      cart_hash: string | null;
      reason: string | null;
      expires_at: string;
    }[]
  >`select id, tab_id, status, bounds, cart_hash, reason, expires_at
    from mandates where id = ${params.id} and kind = 'child'`;
  if (!mandate || mandate.tab_id !== agent.tab_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({
    id: mandate.id,
    status: mandate.status,
    bounds: mandate.bounds,
    cart_hash: mandate.cart_hash,
    reason: mandate.reason,
    expires_at: mandate.expires_at,
  });
}
