import { NextResponse, type NextRequest } from 'next/server';

/**
 * API rate limiting (OT-102): sliding window per client IP and route
 * family, in-memory per instance. On serverless this is per-isolate and
 * resets on cold starts - it is the honest cheap layer that blunts an HN
 * hug and script kiddies, not a distributed quota system. The real
 * protections underneath stay authoritative: tab-scoped keys, the
 * narrowing engine, per-tab velocity, and Stripe's own limits.
 *
 * Deliberately excluded: /api/webhooks/* (Stripe retries must never be
 * dropped; the route verifies signatures and is idempotent) and
 * /api/v1/health (uptime checks). This middleware never redirects and
 * never rewrites; it either passes the request through or answers 429.
 */

interface Rule {
  limit: number;
  windowMs: number;
}

const RULES: [prefix: string, rule: Rule][] = [
  ['/api/auth/', { limit: 30, windowMs: 60_000 }],
  ['/api/step-up/', { limit: 30, windowMs: 60_000 }],
  ['/api/waitlist', { limit: 10, windowMs: 60_000 }],
  ['/api/tabs/', { limit: 60, windowMs: 60_000 }],
  ['/api/v1/', { limit: 120, windowMs: 60_000 }],
];

const hits = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

export function middleware(req: NextRequest): NextResponse {
  const path = req.nextUrl.pathname;
  if (path === '/api/v1/health' || path.startsWith('/api/webhooks/')) {
    return NextResponse.next();
  }
  const match = RULES.find(([prefix]) => path.startsWith(prefix));
  if (!match) return NextResponse.next();
  const [prefix, rule] = match;

  // unbounded-growth guard: a fresh isolate beats a slow leak
  if (hits.size > 50_000) hits.clear();

  const key = `${clientIp(req)}:${prefix}`;
  const now = Date.now();
  const window = (hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (window.length >= rule.limit) {
    const retryMs = rule.windowMs - (now - (window[0] as number));
    return NextResponse.json(
      { error: 'rate_limited', retry_in_ms: retryMs },
      { status: 429, headers: { 'retry-after': String(Math.ceil(retryMs / 1000)) } },
    );
  }
  window.push(now);
  hits.set(key, window);
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
