/**
 * Agent API-key auth (OT-025). Keys look like molt_sk_test_<48 hex chars>,
 * are scoped to exactly one tab, and only their SHA-256 hash is stored.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';

export const KEY_PREFIX = 'molt_sk_test_';

export function generateAgentKey(): { secret: string; hash: string; prefix: string } {
  const secret = `${KEY_PREFIX}${randomBytes(24).toString('hex')}`;
  return { secret, hash: hashKey(secret), prefix: secret.slice(0, KEY_PREFIX.length + 6) };
}

export function hashKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export interface AgentContext {
  key_id: string;
  tab_id: string;
  user_id: string;
}

/** Resolve a Bearer key to its tab scope, or null. Touches last_used_at. */
export async function authenticateAgent(req: Request): Promise<AgentContext | null> {
  const header = req.headers.get('authorization') ?? '';
  const secret = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!secret.startsWith(KEY_PREFIX)) return null;

  const [key] = await db()<{ id: string; tab_id: string; user_id: string }[]>`
    update agent_keys set last_used_at = now()
    where key_hash = ${hashKey(secret)} and status = 'active'
    returning id, tab_id, user_id`;
  if (!key) return null;
  return { key_id: key.id, tab_id: key.tab_id, user_id: key.user_id };
}
