import { NextResponse } from 'next/server';

/**
 * Liveness probe. The TA REST API (/v1/tabs, /v1/mandates, ...) lands in
 * OT-025 (Phase 1). Boot-time test-mode key validation lands in OT-080.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'molt-tab-authority',
    mode: process.env.MOLT_MODE ?? 'test',
  });
}
