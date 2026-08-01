# The Molt Protocol

**Version: v0.1-draft** · Status: drafting alongside the reference implementation. Normative keywords MUST, MUST NOT, SHOULD, MAY per RFC 2119.

Molt is an open protocol for delegating bounded, autonomous spending authority to an AI agent, and for executing purchases at any online merchant, including merchants that expose no agentic commerce protocol at all.

> Draft state: sections 1–5 (concepts, data model, narrowing rule) are the OT-010 scope and are drafted here. Threat model (OT-011), the honesty section (OT-012), and the AP2 compatibility note (OT-013) follow in Phase 1. Schemas in this document are normative and exported as JSON Schema files in `packages/protocol/schemas/`.

## 1. Terminology

- **Tab** — a delegation of spending authority from a user to an agent, bounded by a root mandate. Users "open a tab."
- **Root Mandate** — the signed JSON object of bounds created by one WebAuthn passkey ceremony when a tab is opened.
- **Child Mandate** — a purchase-scoped mandate derived from the root: one merchant, one cart hash, one amount, short TTL. (In user-facing copy, a child mandate plus its payment instrument is a **shell**: a disposable payment credential sized to one cart.)
- **Tab Authority (TA)** — the service that verifies mandates, enforces policy, requests scoped payment instruments from an issuer API, and countersigns receipts. The TA never holds funds and never initiates payments. Anyone can self-host one.
- **Ladder** — the graded set of merchant execution strategies (L0–L3) with declared provenance.
- **Stamp** — the identity layer on all automated requests: RFC 9421 HTTP Message Signatures, `Tab-Context` header, honest user agent.
- **Receipt** — the normalized, dual-signed record of a purchase, verifiable offline.
- **Tap** — the asynchronous step-up: a user passkey assertion that approves a held purchase by signing an amendment to the tab, never a new root.

## 2. The three-party model

```
User ──(one passkey ceremony)──> Tab Authority ──(scoped credentials)──> Agent ──> any merchant
                                      │
                                      └── receipts, audit log, step-up channel
```

The **merchant is deliberately not a party**. It is treated as an untrusted, read-only surface: it installs nothing, agrees to nothing, and sees an ordinary card transaction. This is the protocol's differentiating principle — universal coverage at declared, variable quality — and it is why every receipt records the ladder rung that executed.

Roles:

- **User** — holds the passkey; the only party who can create or amend a tab.
- **Tab Authority** — the only new infrastructure. It authorizes and scopes; issuer rails execute. It MUST NOT hold, receive, or forward funds; MUST NOT initiate payments; MUST NOT perform strong customer authentication for third parties; MUST NOT custody or convert crypto-assets.
- **Agent** — any client of the TA's REST API (reference: an MCP server for Claude). The agent can never self-authorize: opening a tab always returns a ceremony URL for the human.

## 3. Canonicalization and signing

Wherever this spec hashes or signs a JSON object, the object is serialized canonically: object keys sorted lexicographically at every depth, no insignificant whitespace, arrays in given order, no `undefined` members, no non-finite numbers. The reference implementation is `canonicalJson` in `packages/protocol`.

The root-mandate ceremony is bound to its exact bounds: the WebAuthn assertion's challenge MUST be the SHA-256 of the canonical mandate JSON. A verifier MUST recompute the hash from stored bounds and reject on mismatch — tampering with stored bounds is thereby detectable.

The passkey ceremony authenticates the user **to the Tab Authority for mandate signing only**. It is not strong customer authentication under PSD2, and no issuer may rely on it as such.

## 4. Data model

Normative JSON Schemas: [`packages/protocol/schemas/`](packages/protocol/schemas/) — `mandate.schema.json`, `receipt.schema.json`. Amounts are integer minor units; currencies are ISO 4217 codes; timestamps are RFC 3339.

### 4.1 Mandate bounds

Every mandate (root or child) carries the same bounds shape:

| Field               | Meaning                                                      |
| ------------------- | ------------------------------------------------------------ |
| `amount_minor`      | Root: total budget. Child: the exact purchase amount.        |
| `currency`          | ISO 4217 code; a child MUST match its parent.                |
| `per_tx_max_minor`  | Per-transaction ceiling. For a child, equals `amount_minor`. |
| `expires_at`        | Mandate expiry. Child default TTL is 15 minutes.             |
| `mcc_allowlist`     | Allowed merchant category codes.                             |
| `merchant_denylist` | Optional, root only: explicitly blocked merchants.           |
| `velocity_per_hour` | Maximum child mandates per rolling hour.                     |
| `merchant_scope`    | Root: `*` or a pattern. Child: exactly one merchant origin.  |

The root additionally carries a free-text `task_declaration` and a `step_up_policy` mapping each trigger (`unknown_merchant`, `amount_above_baseline`, `mcc_outside_allowlist`, `velocity_exceeded`) to `allow | notify | require_tap | block`. Each child carries a `cart_hash` (SHA-256 of the normalized cart) and a machine-readable `reason` linking it to the task declaration.

### 4.2 The narrowing rule (normative)

> **A child mandate MUST NOT exceed its parent on any bound: amount, expiry, merchant scope, MCC, or velocity.**

Concretely, a TA MUST reject a child mandate unless all of the following hold:

1. `child.amount_minor` ≤ parent remaining budget, and ≤ `parent.per_tx_max_minor`;
2. `child.expires_at` ≤ `parent.expires_at`;
3. `child.mcc_allowlist` ⊆ `parent.mcc_allowlist`;
4. `child.merchant_scope` is exactly one merchant origin, matches `parent.merchant_scope`, and is not on the parent's `merchant_denylist`;
5. `child.velocity_per_hour` ≤ `parent.velocity_per_hour`, and minting the child does not itself exceed the parent's velocity;
6. `child.currency` = `parent.currency`.

Parent remaining budget MUST be decremented atomically with child creation (a serialized transaction or row lock), such that no concurrent sequence of mints can exceed the root total. A child MUST be scoped to one merchant, one cart hash, one amount.

**The blast-radius claim, stated precisely:** compromise of the agent between step-up events is bounded by the outstanding child mandate(s) — a fully compromised agent can spend at most one outstanding child mandate before anomaly triggers fire.

### 4.3 The Ladder

| Rung | Strategy                                  | v1 status                                   |
| ---- | ----------------------------------------- | ------------------------------------------- |
| L0   | Native protocol: x402 settlement; ACP/UCP | x402 real (testnet); ACP/UCP probes stubbed |
| L1   | Deterministic platform adapter            | Shopify                                     |
| L2   | General browser automation                | Stagehand, experimental, preflight-gated    |
| L3   | Hand a deep link to the human             | Always available                            |

Every receipt MUST record the rung that executed. Provenance is declared, never hidden.

### 4.4 The Stamp

All automated HTTP requests MUST carry: an RFC 9421 HTTP Message Signature with the TA-registered agent key; a `Tab-Context` header containing the TA-countersigned child-mandate hash; and an honest user-agent string identifying the agent and implementation.

Stealth measures are prohibited absolutely: no fingerprint spoofing, no CAPTCHA solving, no bot-detection evasion of any kind. If a merchant blocks the agent, the attempt MUST fail with a structured `blocked_by_merchant` result, surfaced honestly.

### 4.5 The Receipt

A receipt records: ladder `rung`, payment `rail`, `merchant`, `amount_minor`/`currency`, `evidence` hashes (DOM SHA-256, screenshot SHA-256, or on-chain transaction hash), `idempotency_key`, and the `mandate_chain` (root-to-child mandate IDs). It is signed by the agent key and countersigned by the TA key, and its shape is identical whether payment executed on a card rail or on-chain. Receipts MUST be verifiable offline (`molt verify receipt.json`) from the receipt document and public keys alone.

### 4.6 The Tap

When policy holds a purchase, the child mandate enters `held` and is unusable. Approval requires a fresh WebAuthn assertion by the user (v1 transport: email link opening a mobile web page); the bare link MUST NOT approve anything. The assertion signs an **amendment to the tab** — never a new root. Step-up requests expire in 15 minutes; expiry cancels the child mandate.

## 5. Payment rails (v1)

Both rails are test-money only in the reference deployment:

- **`card_stripe_test`** — an approved child mandate is realized as a single-use Stripe Issuing test-mode virtual card whose `spending_controls` mirror the mandate bounds. This is how "any store" works: the merchant sees a normal card. Card details are returned to the agent once and never stored.
- **`usdc_x402_testnet`** — x402 settlement in testnet USDC on Base Sepolia from an agent-operator-owned local wallet. Mandate bounds are enforced client-side before signing. The TA sees addresses and receipts, never key material.

## 6. Threat model

_(OT-011 — Phase 1.)_

## 7. What Molt deliberately does not do

_(OT-012 — Phase 1. Committed scope: no bot-detection evasion, no funds custody, no SCA performance, no post-purchase state guarantees, no ToS dissolution.)_

## Appendix A. AP2 compatibility

_(OT-013 — Phase 1.)_
