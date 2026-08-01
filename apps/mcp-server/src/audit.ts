/**
 * Local audit log (OT-041): one JSONL line per tool call, mirroring the
 * TA-side events table from the agent's perspective. Card details never
 * appear here - they never enter tool arguments and outcomes are summarized
 * to status only.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEntry {
  ts: string;
  tool: string;
  /** Arguments as received (tool inputs never contain card data). */
  args: unknown;
  /** Outcome summary: status/error class, never full payloads. */
  outcome: string;
  duration_ms: number;
}

let prepared = false;

export function appendAudit(path: string, entry: AuditEntry): void {
  try {
    if (!prepared) {
      mkdirSync(dirname(path), { recursive: true });
      prepared = true;
    }
    appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch {
    // auditing must never take the server down; the TA-side events table
    // remains the authoritative trail
  }
}
