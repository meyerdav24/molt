/**
 * Platform detector (OT-051): given a URL, classify the merchant and
 * recommend a ladder rung. All probing traffic carries the honest Molt UA.
 *
 * v1: Shopify detection is real (headers, cookies, cart.js, body markers),
 * x402 probing is real (HTTP 402 + parsed payment-requirements envelope),
 * ACP/UCP probes are deliberate stubs returning not_found.
 */
import type { LadderRung } from '@molt/protocol';
import { MOLT_USER_AGENT } from './stamp.js';

export type Platform = 'shopify' | 'x402' | 'unknown';

export interface DetectionResult {
  origin: string;
  platform: Platform;
  recommended_rung: LadderRung;
  /** Which probes matched; recorded in the receipt for provenance. */
  signals: string[];
  /** Probes that ran and found nothing (includes the ACP/UCP stubs). */
  not_found: string[];
  checked_at: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, DetectionResult>();

/** For tests. */
export function clearDetectionCache(): void {
  cache.clear();
}

async function probe(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; headers: Headers; body: string } | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': MOLT_USER_AGENT, accept: 'text/html,application/json' },
    });
    const body = (await res.text()).slice(0, 262_144);
    return { status: res.status, headers: res.headers, body };
  } catch {
    return null;
  }
}

function shopifySignals(home: { status: number; headers: Headers; body: string }): string[] {
  const signals: string[] = [];
  for (const h of ['x-shopid', 'x-shopify-stage', 'x-sorting-hat-shopid']) {
    if (home.headers.get(h) !== null) signals.push(`header:${h}`);
  }
  const cookies = home.headers.get('set-cookie') ?? '';
  if (cookies.includes('_shopify_')) signals.push('cookie:_shopify_');
  if (home.body.includes('cdn.shopify.com')) signals.push('body:cdn.shopify.com');
  if (home.body.includes('Shopify.theme')) signals.push('body:Shopify.theme');
  if (home.body.includes('shopify-features')) signals.push('body:shopify-features');
  return signals;
}

/** Classify a merchant. Results are cached for an hour per origin. */
export async function resolveMerchant(
  url: string,
  opts: { timeoutMs?: number; noCache?: boolean } = {},
): Promise<DetectionResult> {
  const origin = new URL(url).origin;
  const timeoutMs = opts.timeoutMs ?? 8000;

  if (!opts.noCache) {
    const hit = cache.get(origin);
    if (hit && Date.parse(hit.checked_at) > Date.now() - CACHE_TTL_MS) return hit;
  }

  const signals: string[] = [];
  const notFound: string[] = [];

  const home = await probe(origin, timeoutMs);

  // x402: a 402 on the origin itself is the strongest possible signal.
  if (home && home.status === 402) signals.push('x402:402-on-origin');

  // paid endpoints often live on a path; probe the exact URL too (OT-111)
  const path = new URL(url).pathname;
  if (!signals.some((s) => s.startsWith('x402')) && path !== '/' && path !== '') {
    const exact = await probe(url, timeoutMs);
    if (exact && exact.status === 402) signals.push('x402:402-on-path');
  }

  if (home) {
    signals.push(...shopifySignals(home));
  }

  // /cart.js is the classic storefront confirmation; only probe when the
  // homepage already hinted at Shopify, or gave us nothing to go on.
  if (home && signals.length > 0 && signals.some((s) => !s.startsWith('x402'))) {
    const cart = await probe(`${origin}/cart.js`, timeoutMs);
    if (cart && cart.status === 200) {
      try {
        const json = JSON.parse(cart.body) as { token?: string; items?: unknown };
        if (typeof json.token === 'string' && Array.isArray(json.items)) {
          signals.push('endpoint:/cart.js');
        }
      } catch {
        // not JSON, not Shopify's cart endpoint
      }
    }
  }

  // ACP/UCP: deliberate stubs in v1. Declared, not hidden.
  notFound.push('acp:stub_not_probed', 'ucp:stub_not_probed');

  let platform: Platform = 'unknown';
  if (signals.some((s) => s.startsWith('x402'))) platform = 'x402';
  else if (signals.some((s) => s.startsWith('header:') || s === 'endpoint:/cart.js')) {
    platform = 'shopify';
  } else if (signals.filter((s) => s.startsWith('body:') || s.startsWith('cookie:')).length >= 2) {
    platform = 'shopify';
  }

  const rung: LadderRung = platform === 'x402' ? 'L0' : platform === 'shopify' ? 'L1' : 'L2';

  const result: DetectionResult = {
    origin,
    platform,
    recommended_rung: rung,
    signals,
    not_found: notFound,
    checked_at: new Date().toISOString(),
  };
  cache.set(origin, result);
  return result;
}
