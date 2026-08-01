/**
 * Policy engine + step-up triggers (OT-023).
 *
 * Evaluates a child-mandate request against the tab's step-up policy BEFORE
 * minting. Pure and clock-free like the mandate engine. The narrowing engine
 * is the hard floor (it refuses what exceeds bounds outright); this engine
 * decides how to treat requests that are inside the bounds but unusual:
 * auto-approve, notify, hold for a Tap, or block.
 *
 * Every fired trigger carries a human-readable reason — callers write the
 * full decision to the events audit log.
 */
import type { MandateBounds, StepUpAction, StepUpPolicy } from './types.js';

/** Amounts above this fraction of per-tx max fire amount_above_baseline. */
export const AMOUNT_PER_TX_FRACTION = 0.8;
/** Amounts above MULTIPLIER x median of recent purchases fire amount_above_baseline. */
export const BASELINE_MULTIPLIER = 3;
/** Minimum purchase history before the rolling baseline applies. */
export const BASELINE_MIN_SAMPLES = 3;

export interface PolicyContext {
  /** The tab's per-trigger step-up policy, as signed at the ceremony. */
  policy: StepUpPolicy;
  /** Root mandate bounds. */
  bounds: MandateBounds;
  /** Merchant origins already purchased from in this tab. */
  known_merchants: string[];
  /** Amounts (minor units) of previous completed purchases in this tab. */
  recent_amounts_minor: number[];
  /** RFC 3339 creation times of children minted in this tab. */
  recent_mint_times: string[];
  now: Date;
}

export interface PolicyRequest {
  merchant_origin: string;
  amount_minor: number;
  /** Detected MCC of the merchant, if known. */
  mcc?: string;
}

export type PolicyTriggerName = keyof StepUpPolicy;

export interface FiredTrigger {
  trigger: PolicyTriggerName;
  action: StepUpAction;
  reason: string;
}

export type PolicyOutcome = 'auto_approve' | 'notify' | 'hold_for_tap' | 'block';

export interface PolicyDecision {
  outcome: PolicyOutcome;
  /** Every trigger that fired, with the configured action and the reasoning. */
  triggers: FiredTrigger[];
}

const SEVERITY: Record<StepUpAction, number> = {
  allow: 0,
  notify: 1,
  require_tap: 2,
  block: 3,
};

const OUTCOME_FOR_ACTION: Record<StepUpAction, PolicyOutcome> = {
  allow: 'auto_approve',
  notify: 'notify',
  require_tap: 'hold_for_tap',
  block: 'block',
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (sorted.length % 2 === 0 && lo !== undefined && hi !== undefined) return (lo + hi) / 2;
  return hi ?? 0;
}

/**
 * Evaluate a request. Severity of the strictest fired trigger wins:
 * block > require_tap > notify > allow; nothing fired -> auto_approve.
 */
export function evaluatePolicy(ctx: PolicyContext, req: PolicyRequest): PolicyDecision {
  const fired: FiredTrigger[] = [];

  // unknown_merchant: never purchased from in this tab
  if (!ctx.known_merchants.includes(req.merchant_origin)) {
    fired.push({
      trigger: 'unknown_merchant',
      action: ctx.policy.unknown_merchant,
      reason: `merchant ${req.merchant_origin} has not been seen in this tab before`,
    });
  }

  // amount_above_baseline: fraction of per-tx max, or rolling median baseline
  const fractionLimit = Math.floor(ctx.bounds.per_tx_max_minor * AMOUNT_PER_TX_FRACTION);
  if (req.amount_minor > fractionLimit) {
    fired.push({
      trigger: 'amount_above_baseline',
      action: ctx.policy.amount_above_baseline,
      reason: `amount ${req.amount_minor} exceeds ${AMOUNT_PER_TX_FRACTION * 100}% of per-tx max (${fractionLimit})`,
    });
  } else if (ctx.recent_amounts_minor.length >= BASELINE_MIN_SAMPLES) {
    const base = median(ctx.recent_amounts_minor);
    if (req.amount_minor > base * BASELINE_MULTIPLIER) {
      fired.push({
        trigger: 'amount_above_baseline',
        action: ctx.policy.amount_above_baseline,
        reason: `amount ${req.amount_minor} exceeds ${BASELINE_MULTIPLIER}x the rolling median (${base})`,
      });
    }
  }

  // mcc_outside_allowlist: detected MCC not in the tab's allowlist
  if (req.mcc !== undefined && ctx.bounds.mcc_allowlist.length > 0) {
    if (!ctx.bounds.mcc_allowlist.includes(req.mcc)) {
      fired.push({
        trigger: 'mcc_outside_allowlist',
        action: ctx.policy.mcc_outside_allowlist,
        reason: `MCC ${req.mcc} is outside the tab's allowlist`,
      });
    }
  }

  // velocity_exceeded: minting this child would exceed the hourly limit
  const hourAgo = ctx.now.getTime() - 3600_000;
  const recent = ctx.recent_mint_times.filter((t) => {
    const ms = Date.parse(t);
    return !Number.isNaN(ms) && ms > hourAgo && ms <= ctx.now.getTime();
  }).length;
  if (recent >= ctx.bounds.velocity_per_hour) {
    fired.push({
      trigger: 'velocity_exceeded',
      action: ctx.policy.velocity_exceeded,
      reason: `${recent} purchases in the last hour reach the limit of ${ctx.bounds.velocity_per_hour}/h`,
    });
  }

  let outcome: PolicyOutcome = 'auto_approve';
  let top = -1;
  for (const f of fired) {
    if (SEVERITY[f.action] > top) {
      top = SEVERITY[f.action];
      outcome = OUTCOME_FOR_ACTION[f.action];
    }
  }

  return { outcome, triggers: fired };
}
