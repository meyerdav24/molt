import { NextResponse } from 'next/server';
import { generateAgentKey } from '../../../../../lib/agent-auth';
import { db } from '../../../../../lib/db';
import { getSessionUserId } from '../../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List agent keys for a tab (dashboard). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const keys = await db()<
    {
      id: string;
      key_prefix: string;
      status: string;
      created_at: string;
      last_used_at: string | null;
    }[]
  >`select k.id, k.key_prefix, k.status, k.created_at, k.last_used_at
    from agent_keys k join tabs t on t.id = k.tab_id
    where k.tab_id = ${params.id} and t.user_id = ${userId}
    order by k.created_at desc`;
  return NextResponse.json({ keys });
}

/**
 * Create/rotate the agent key for a tab (dashboard, OT-025 AC): revokes all
 * active keys and mints a new one. The secret appears in this response once
 * and is never retrievable again.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sql = db();
  const [tab] = await sql<{ id: string }[]>`
    select id from tabs where id = ${params.id} and user_id = ${userId}`;
  if (!tab) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { secret, hash, prefix } = generateAgentKey();
  await sql.begin(async (tx) => {
    await tx`
      update agent_keys set status = 'revoked', revoked_at = now()
      where tab_id = ${tab.id} and status = 'active'`;
    await tx`
      insert into agent_keys (tab_id, user_id, key_hash, key_prefix)
      values (${tab.id}, ${userId}, ${hash}, ${prefix})`;
    await tx`
      insert into events (tab_id, user_id, actor, type, payload)
      values (${tab.id}, ${userId}, 'user', 'agent_key.rotated', ${tx.json({ prefix })})`;
  });

  return NextResponse.json({ secret, prefix }, { status: 201 });
}
