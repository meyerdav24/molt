/**
 * Where a key handed over at runtime lives.
 *
 * Precedence: MOLT_AGENT_KEY from the environment always wins, so an
 * operator-managed deployment is never overridden by something an agent
 * adopted. Otherwise the file written by the connect_tab tool is used, so a
 * server that was connected through the chat stays connected across
 * restarts without anyone editing a config.
 *
 * The file is a credential: owner-only permissions, and the key is only
 * ever sent to the Tab Authority it belongs to.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface KeyFile {
  version: 1;
  agent_key: string;
  tab_id: string;
  api_url: string;
  connected_at: string;
}

export function readStoredKey(path: string, apiUrl: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as KeyFile;
    // A key belongs to the Tab Authority that issued it; ignore a file left
    // over from a different instance rather than sending the key there.
    if (file.api_url !== apiUrl) return undefined;
    return file.agent_key;
  } catch {
    return undefined;
  }
}

export function storeKey(
  path: string,
  data: { agent_key: string; tab_id: string; api_url: string },
): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: KeyFile = { version: 1, ...data, connected_at: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
}
