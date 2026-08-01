/**
 * Per-key rate limiting (OT-041), sliding window, in-process. The agent key
 * identifies the caller (one key = one tab); over SSE several sessions can
 * share a key and they share its budget. This is the polite-client layer -
 * the TA's velocity checks and the mandate bounds remain the enforcement
 * that matters.
 */

interface Window {
  stamps: number[];
}

export interface RateRule {
  limit: number;
  windowMs: number;
}

/** purchase moves money-shaped state; everything else is cheap reads. */
export const RATE_RULES: Record<string, RateRule[]> = {
  purchase: [
    { limit: 3, windowMs: 60_000 },
    { limit: 12, windowMs: 3_600_000 },
  ],
  default: [{ limit: 30, windowMs: 60_000 }],
};

const windows = new Map<string, Window>();

/** Returns null if allowed, otherwise the ms to wait before retrying. */
export function checkRate(key: string, tool: string, now = Date.now()): number | null {
  const rules = RATE_RULES[tool] ?? RATE_RULES['default'] ?? [];
  let retryInMs: number | null = null;
  for (const rule of rules) {
    const id = `${key}:${tool}:${rule.windowMs}`;
    const win = windows.get(id) ?? { stamps: [] };
    win.stamps = win.stamps.filter((t) => now - t < rule.windowMs);
    if (win.stamps.length >= rule.limit) {
      const oldest = win.stamps[0] as number;
      const wait = rule.windowMs - (now - oldest);
      retryInMs = Math.max(retryInMs ?? 0, wait);
    }
    windows.set(id, win);
  }
  if (retryInMs !== null) return retryInMs;
  for (const rule of rules) {
    const id = `${key}:${tool}:${rule.windowMs}`;
    windows.get(id)?.stamps.push(now);
  }
  return null;
}

/** Test hook. */
export function resetRateLimits(): void {
  windows.clear();
}
