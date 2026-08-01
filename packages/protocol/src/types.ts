/**
 * Core protocol types. These mirror the JSON Schemas in /schemas and the
 * data model in SPEC.md; the schemas are normative, these types follow them.
 *
 * Vocabulary rule: formal terms (child mandate, card, payment payload) in code
 * identifiers; "shell" is UI/marketing copy only (see demo/VOCAB.md).
 */

/** Operating mode. The reference TA and hosted beta support only 'test' (guardrail G1). */
export type MoltMode = 'test' | 'live_self_hosted';

/** Execution ladder rung, recorded on every receipt. */
export type LadderRung = 'L0' | 'L1' | 'L2' | 'L3';

/** Payment rail, recorded on every receipt. */
export type PaymentRail = 'card_stripe_test' | 'usdc_x402_testnet';

/** ISO 4217 currency code. */
export type CurrencyCode = string;

/** Amounts are integer minor units (cents) everywhere. Never floats. */
export type AmountMinor = number;

/** Step-up policy outcome per trigger. */
export type StepUpAction = 'allow' | 'notify' | 'require_tap' | 'block';

export interface StepUpPolicy {
  unknown_merchant: StepUpAction;
  amount_above_baseline: StepUpAction;
  mcc_outside_allowlist: StepUpAction;
  velocity_exceeded: StepUpAction;
}

/**
 * Bounds shared by root and child mandates. The narrowing rule (SPEC.md,
 * normative): a child mandate MUST NOT exceed its parent on any bound.
 */
export interface MandateBounds {
  /** Total budget (root) or exact purchase amount (child), in minor units. */
  amount_minor: AmountMinor;
  currency: CurrencyCode;
  /** Per-transaction maximum in minor units. For a child this equals amount_minor. */
  per_tx_max_minor: AmountMinor;
  /** RFC 3339 timestamp. A child's expiry MUST NOT be later than its parent's. */
  expires_at: string;
  /** Allowed merchant category codes. A child's set MUST be a subset of its parent's. */
  mcc_allowlist: string[];
  /** Optional explicit merchant denylist (root only). */
  merchant_denylist?: string[];
  /** Maximum number of child mandates per rolling hour. */
  velocity_per_hour: number;
  /**
   * Merchant scope. Root: '*' or a pattern; child: exactly one merchant origin,
   * e.g. 'https://store.example.com'.
   */
  merchant_scope: string;
}

export interface RootMandate {
  id: string;
  kind: 'root';
  tab_id: string;
  bounds: MandateBounds;
  /** Free-text task declaration the user signed, e.g. "Restock the office". */
  task_declaration: string;
  step_up_policy: StepUpPolicy;
  /**
   * WebAuthn assertion whose challenge is the SHA-256 of the canonical mandate
   * JSON. Authenticates the user to Molt for mandate signing only — never SCA
   * (guardrail G3).
   */
  webauthn_assertion: unknown;
  /** Hex SHA-256 of the canonical bounds JSON that the assertion signed. */
  challenge_hash: string;
  created_at: string;
}

export interface ChildMandate {
  id: string;
  kind: 'child';
  tab_id: string;
  parent_id: string;
  bounds: MandateBounds;
  /** SHA-256 of the normalized cart this mandate is scoped to. */
  cart_hash: string;
  /** Machine-readable link from this child to the root task declaration. */
  reason: string;
  status:
    'pending' | 'active' | 'held' | 'approved' | 'denied' | 'expired' | 'consumed' | 'revoked';
  created_at: string;
}

export type Mandate = RootMandate | ChildMandate;

/** Evidence captured at the commit moment, stored as hashes on the receipt. */
export interface ReceiptEvidence {
  dom_sha256?: string;
  screenshot_sha256?: string;
  /** L0: on-chain transaction hash on Base Sepolia. */
  onchain_tx_hash?: string;
}

/**
 * The Receipt: normalized, dual-signed record. Identical shape whether payment
 * went through a card or on-chain. Verifiable offline via `molt verify`.
 */
export interface Receipt {
  id: string;
  tab_id: string;
  mandate_id: string;
  rung: LadderRung;
  rail: PaymentRail;
  merchant: string;
  amount_minor: AmountMinor;
  currency: CurrencyCode;
  evidence: ReceiptEvidence;
  idempotency_key: string;
  /** Root-to-child mandate id chain, root first. */
  mandate_chain: string[];
  agent_signature: string;
  ta_signature: string;
  created_at: string;
}
