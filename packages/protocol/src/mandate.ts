/**
 * Mandate tree engine + narrowing validator (OT-022).
 *
 * Pure functions only: no clock, no randomness, no I/O — `now` and `id` are
 * always passed in. The atomicity layer (conditional budget decrement, row
 * locks) lives in the mint_child_mandate() SQL function; this module is the
 * single source of truth for the narrowing rule itself.
 *
 * The narrowing rule (SPEC.md 4.2, normative): a child mandate MUST NOT
 * exceed its parent on any bound — amount, expiry, merchant scope, MCC,
 * velocity. Children are scoped to one merchant, one cart hash, one amount.
 */
import type { ChildMandate, MandateBounds } from './types.js';

/** Default child TTL: 15 minutes. */
export const CHILD_DEFAULT_TTL_SECONDS = 15 * 60;

export type NarrowingViolationCode =
  | 'parent_not_active'
  | 'parent_expired'
  | 'amount_invalid'
  | 'amount_exceeds_parent_total'
  | 'amount_exceeds_per_tx_max'
  | 'amount_exceeds_remaining'
  | 'per_tx_max_exceeds_parent'
  | 'expiry_exceeds_parent'
  | 'expiry_invalid'
  | 'currency_mismatch'
  | 'mcc_not_subset'
  | 'velocity_exceeds_parent'
  | 'velocity_exceeded'
  | 'merchant_scope_not_single_origin'
  | 'merchant_scope_mismatch'
  | 'merchant_denylisted'
  | 'cart_hash_invalid'
  | 'reason_missing'
  | 'ttl_invalid';

export interface NarrowingViolation {
  code: NarrowingViolationCode;
  message: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

function isPositiveInt(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0;
}

/**
 * True if `value` is exactly one http(s) origin (scheme + host + optional
 * port, no path, no query, no wildcard).
 */
export function isSingleOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
}

/**
 * Does a child origin fall inside a parent merchant scope?
 * v1 scopes: '*' (any merchant) or one exact origin.
 */
export function matchesMerchantScope(parentScope: string, childOrigin: string): boolean {
  return parentScope === '*' || parentScope === childOrigin;
}

/**
 * The narrowing validator: static comparison of child bounds against parent
 * bounds. Returns every violation, never just the first — callers log the
 * full list to the audit trail. Budget/velocity *state* checks live in
 * mintChildMandate; this function is also used by verifiers on stored data.
 */
export function validateNarrowing(
  parent: MandateBounds,
  child: MandateBounds,
): NarrowingViolation[] {
  const v: NarrowingViolation[] = [];

  if (child.currency !== parent.currency) {
    v.push({
      code: 'currency_mismatch',
      message: `child currency ${child.currency} != parent ${parent.currency}`,
    });
  }

  if (!isPositiveInt(child.amount_minor)) {
    v.push({ code: 'amount_invalid', message: 'child amount must be a positive integer' });
  } else {
    if (child.amount_minor > parent.amount_minor) {
      v.push({
        code: 'amount_exceeds_parent_total',
        message: `child amount ${child.amount_minor} > parent total ${parent.amount_minor}`,
      });
    }
    if (child.amount_minor > parent.per_tx_max_minor) {
      v.push({
        code: 'amount_exceeds_per_tx_max',
        message: `child amount ${child.amount_minor} > parent per-tx max ${parent.per_tx_max_minor}`,
      });
    }
  }

  if (child.per_tx_max_minor > parent.per_tx_max_minor) {
    v.push({
      code: 'per_tx_max_exceeds_parent',
      message: `child per-tx max ${child.per_tx_max_minor} > parent ${parent.per_tx_max_minor}`,
    });
  }

  const childExp = Date.parse(child.expires_at);
  const parentExp = Date.parse(parent.expires_at);
  if (Number.isNaN(childExp)) {
    v.push({ code: 'expiry_invalid', message: 'child expires_at is not a valid timestamp' });
  } else if (childExp > parentExp) {
    v.push({
      code: 'expiry_exceeds_parent',
      message: `child expiry ${child.expires_at} is after parent expiry ${parent.expires_at}`,
    });
  }

  const parentMccs = new Set(parent.mcc_allowlist);
  if (parent.mcc_allowlist.length > 0) {
    for (const mcc of child.mcc_allowlist) {
      if (!parentMccs.has(mcc)) {
        v.push({ code: 'mcc_not_subset', message: `MCC ${mcc} not in parent allowlist` });
        break;
      }
    }
  }

  if (child.velocity_per_hour > parent.velocity_per_hour) {
    v.push({
      code: 'velocity_exceeds_parent',
      message: `child velocity ${child.velocity_per_hour}/h > parent ${parent.velocity_per_hour}/h`,
    });
  }

  if (!isSingleOrigin(child.merchant_scope)) {
    v.push({
      code: 'merchant_scope_not_single_origin',
      message: `child merchant scope must be exactly one http(s) origin, got: ${child.merchant_scope}`,
    });
  } else {
    if (!matchesMerchantScope(parent.merchant_scope, child.merchant_scope)) {
      v.push({
        code: 'merchant_scope_mismatch',
        message: `child merchant ${child.merchant_scope} outside parent scope ${parent.merchant_scope}`,
      });
    }
    if (parent.merchant_denylist?.includes(child.merchant_scope)) {
      v.push({
        code: 'merchant_denylisted',
        message: `merchant ${child.merchant_scope} is on the parent denylist`,
      });
    }
  }

  return v;
}

/** What the engine needs to know about the parent at mint time. */
export interface ParentContext {
  tab_id: string;
  parent_id: string;
  bounds: MandateBounds;
  status: string;
  /** Parent's remaining budget in minor units (root: tabs.remaining_minor). */
  remaining_minor: number;
  /** RFC 3339 creation times of children already minted from this parent. */
  recent_mint_times: string[];
}

/** A purchase-scoped mint request from the agent. */
export interface MintRequest {
  /** Exactly one http(s) origin, e.g. https://store.example.com */
  merchant_origin: string;
  /** Exact cart amount in minor units. */
  amount_minor: number;
  /** Hex SHA-256 of the normalized cart. */
  cart_hash: string;
  /** Machine-readable link to the root task declaration. */
  reason: string;
  /** MCC of the merchant if known; must be inside the parent allowlist. */
  mcc?: string;
  /** Override TTL in seconds; defaults to 15 minutes, clamped to parent expiry. */
  ttl_seconds?: number;
}

export type MintResult =
  | { ok: true; child: ChildMandate; new_remaining_minor: number }
  | { ok: false; violations: NarrowingViolation[] };

/**
 * Mint a maximally-narrow child mandate from a parent: one merchant, one cart
 * hash, one amount, per-tx max = amount, velocity 1/h, TTL <= 15 min clamped
 * to the parent expiry. Fails closed with the full violation list.
 *
 * Persisting the result MUST go through the atomic DB path (conditional
 * decrement of the parent's remaining budget) — this function decides, the
 * database enforces under concurrency.
 */
export function mintChildMandate(
  parent: ParentContext,
  req: MintRequest,
  opts: { now: Date; id: string },
): MintResult {
  const violations: NarrowingViolation[] = [];
  const nowMs = opts.now.getTime();

  if (parent.status !== 'active') {
    violations.push({ code: 'parent_not_active', message: `parent status is ${parent.status}` });
  }
  if (Date.parse(parent.bounds.expires_at) <= nowMs) {
    violations.push({ code: 'parent_expired', message: 'parent mandate has expired' });
  }

  if (!isPositiveInt(req.amount_minor)) {
    violations.push({ code: 'amount_invalid', message: 'amount must be a positive integer' });
  } else if (req.amount_minor > parent.remaining_minor) {
    violations.push({
      code: 'amount_exceeds_remaining',
      message: `amount ${req.amount_minor} > remaining budget ${parent.remaining_minor}`,
    });
  }

  if (!HEX64.test(req.cart_hash)) {
    violations.push({ code: 'cart_hash_invalid', message: 'cart_hash must be hex SHA-256' });
  }
  if (!req.reason.trim()) {
    violations.push({
      code: 'reason_missing',
      message: 'reason linking to task declaration required',
    });
  }

  const ttl = req.ttl_seconds ?? CHILD_DEFAULT_TTL_SECONDS;
  if (!isPositiveInt(ttl) || ttl > CHILD_DEFAULT_TTL_SECONDS) {
    violations.push({
      code: 'ttl_invalid',
      message: `ttl must be 1..${CHILD_DEFAULT_TTL_SECONDS} seconds`,
    });
  }

  // One rolling hour of successful mints counts against the parent velocity.
  const hourAgo = nowMs - 3600_000;
  const recent = parent.recent_mint_times.filter((t) => {
    const ms = Date.parse(t);
    return !Number.isNaN(ms) && ms > hourAgo && ms <= nowMs;
  }).length;
  if (recent >= parent.bounds.velocity_per_hour) {
    violations.push({
      code: 'velocity_exceeded',
      message: `${recent} mints in the last hour >= velocity limit ${parent.bounds.velocity_per_hour}/h`,
    });
  }

  if (violations.length > 0) return dedupe(violations);

  const childExpiryMs = Math.min(nowMs + ttl * 1000, Date.parse(parent.bounds.expires_at));
  const bounds: MandateBounds = {
    amount_minor: req.amount_minor,
    currency: parent.bounds.currency,
    per_tx_max_minor: req.amount_minor,
    expires_at: new Date(childExpiryMs).toISOString(),
    mcc_allowlist: req.mcc !== undefined ? [req.mcc] : [...parent.bounds.mcc_allowlist],
    velocity_per_hour: 1,
    merchant_scope: req.merchant_origin,
  };

  const narrowing = validateNarrowing(parent.bounds, bounds);
  if (narrowing.length > 0) return dedupe(narrowing);

  const child: ChildMandate = {
    id: opts.id,
    kind: 'child',
    tab_id: parent.tab_id,
    parent_id: parent.parent_id,
    bounds,
    cart_hash: req.cart_hash,
    reason: req.reason,
    status: 'pending',
    created_at: opts.now.toISOString(),
  };

  return { ok: true, child, new_remaining_minor: parent.remaining_minor - req.amount_minor };
}

function dedupe(violations: NarrowingViolation[]): { ok: false; violations: NarrowingViolation[] } {
  const seen = new Set<string>();
  return {
    ok: false,
    violations: violations.filter((v) => !seen.has(v.code) && seen.add(v.code) !== undefined),
  };
}
