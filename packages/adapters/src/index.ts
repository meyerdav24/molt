/**
 * Execution ladder adapters (Epic 5, Epic 11). Phase 0 scaffold.
 *
 * Ladder: L0 native protocol (x402 real; ACP/UCP stubbed) → L1 Shopify →
 * L2 Stagehand fallback → L3 deep link handed to the human.
 *
 * The Stamp applies to everything here: RFC 9421 signatures, Tab-Context
 * header, honest user agent. Zero stealth measures — if blocked, fail
 * honestly with `blocked_by_merchant`.
 */
import type { LadderRung } from '@molt/protocol';

export interface MerchantResolution {
  url: string;
  platform: 'shopify' | 'x402' | 'unknown';
  recommended_rung: LadderRung;
}

/** Placeholder until OT-051 (platform detector) lands in Phase 2. */
export function resolveMerchantStub(url: string): MerchantResolution {
  return { url, platform: 'unknown', recommended_rung: 'L3' };
}
