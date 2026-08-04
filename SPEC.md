# The Molt Protocol

**Version: v0.1-draft** · Status: drafting alongside the reference implementation. Normative keywords MUST, MUST NOT, SHOULD, MAY per RFC 2119.

Molt is an open protocol for delegating bounded, autonomous spending authority to an AI agent, and for executing purchases at any online merchant, including merchants that expose no agentic commerce protocol at all.

> Draft state: all sections drafted (concepts and data model per OT-010, threat model per OT-011, section 7 per OT-012, Appendix A per OT-013); the document finalizes against the implementation before launch. Schemas in this document are normative and exported as JSON Schema files in `packages/protocol/schemas/`.

## 1. Terminology

- **Tab**: a delegation of spending authority from a user to an agent, bounded by a root mandate. Users "open a tab."
- **Root Mandate**: the signed JSON object of bounds created by one WebAuthn passkey ceremony when a tab is opened.
- **Child Mandate**: a purchase-scoped mandate derived from the root: one merchant, one cart hash, one amount, short TTL. (In user-facing copy, a child mandate plus its payment instrument is a **shell**: a disposable payment credential sized to one cart.)
- **Tab Authority (TA)**: the service that verifies mandates, enforces policy, requests scoped payment instruments from an issuer API, and countersigns receipts. The TA never holds funds and never initiates payments. Anyone can self-host one.
- **Ladder**: the graded set of merchant execution strategies (L0–L3) with declared provenance.
- **Stamp**: the identity layer on all automated requests: RFC 9421 HTTP Message Signatures, `Tab-Context` header, honest user agent.
- **Receipt**: the normalized, dual-signed record of a purchase, verifiable offline.
- **Tap**: the asynchronous step-up: a user passkey assertion that approves a held purchase by signing an amendment to the tab, never a new root.

## 2. The three-party model

```
User ──(one passkey ceremony)──> Tab Authority ──(scoped credentials)──> Agent ──> any merchant
                                      │
                                      └── receipts, audit log, step-up channel
```

The **merchant is deliberately not a party**. It is treated as an untrusted, read-only surface: it installs nothing, agrees to nothing, and sees an ordinary card transaction. This is the protocol's differentiating principle (universal coverage at declared, variable quality), and it is why every receipt records the ladder rung that executed.

Roles:

- **User**: holds the passkey; the only party who can create or amend a tab.
- **Tab Authority**: the only new infrastructure. It authorizes and scopes; issuer rails execute. It MUST NOT hold, receive, or forward funds; MUST NOT initiate payments; MUST NOT perform strong customer authentication for third parties; MUST NOT custody or convert crypto-assets.
- **Agent**: any client of the TA's REST API (reference: an MCP server for Claude). The agent can never self-authorize: opening a tab always returns a ceremony URL for the human.

## 3. Canonicalization and signing

Wherever this spec hashes or signs a JSON object, the object is serialized canonically: object keys sorted lexicographically at every depth, no insignificant whitespace, arrays in given order, no `undefined` members, no non-finite numbers. The reference implementation is `canonicalJson` in `packages/protocol`.

The root-mandate ceremony is bound to its exact bounds: the WebAuthn assertion's challenge MUST be the SHA-256 of the canonical mandate JSON. A verifier MUST recompute the hash from stored bounds and reject on mismatch; tampering with stored bounds is thereby detectable.

The passkey ceremony authenticates the user **to the Tab Authority for mandate signing only**. It is not strong customer authentication under PSD2, and no issuer may rely on it as such.

## 4. Data model

Normative JSON Schemas: [`packages/protocol/schemas/`](packages/protocol/schemas/): `mandate.schema.json`, `receipt.schema.json`. Amounts are integer minor units; currencies are ISO 4217 codes; timestamps are RFC 3339.

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

**The blast-radius claim, stated precisely:** compromise of the agent between step-up events is bounded by the outstanding child mandate(s). A merchant the tab has never paid before fires `unknown_merchant`, so under a `hold_for_tap` policy an agent cannot direct spending anywhere new without a fresh user assertion. At a merchant already on record, the reachable amount is bounded by `per_tx_max_minor` × `velocity_per_hour` and by the root's remaining total, with `amount_above_baseline` holding anything unusual for that tab. Implementations MAY additionally refuse to mint while an unexpired child is outstanding, which reduces the bound to exactly one child mandate; the reference implementation does not yet do this (see `mint_child_mandate`).

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

When policy holds a purchase, the child mandate enters `held` and is unusable. Approval requires a fresh WebAuthn assertion by the user (v1 transport: email link opening a mobile web page); the bare link MUST NOT approve anything. The assertion signs an **amendment to the tab**, never a new root. Step-up requests expire in 15 minutes; expiry cancels the child mandate.

## 5. Payment rails (v1)

Both rails are test-money only in the reference deployment:

- **`card_stripe_test`**: an approved child mandate is realized as a single-use Stripe Issuing test-mode virtual card whose `spending_controls` mirror the mandate bounds. This is how "any store" works: the merchant sees a normal card. Card details are returned to the agent once and never stored.
- **`usdc_x402_testnet`**: x402 settlement in testnet USDC on Base Sepolia from an agent-operator-owned local wallet. Mandate bounds are enforced client-side before signing. The TA sees addresses and receipts, never key material.

## 6. Threat model

The asset under protection is the user's spending authority. Molt's design goal is not to make agent compromise impossible. It is to make the worst case small, visible, and recoverable. The claim, stated precisely:

> **Compromise of the agent between step-up events is bounded by the outstanding child mandate(s). A fully compromised agent cannot direct spending to a merchant the tab has not already paid, and at a merchant already on record it is bounded by the per-transaction cap, the velocity limit, and the remaining root total the user signed.**

This section lists the adversaries the protocol is designed against, what it guarantees for each, and, just as importantly, what it does not.

### 6.1 Prompt-injected or fully compromised agent

The agent reads untrusted content (product pages, search results, emails) and must be assumed injectable. Molt therefore treats the agent as untrusted by construction.

**Guaranteed:** The agent never holds the user's real card, only single-use instruments scoped to one merchant, one cart, one amount, with a 15-minute TTL. It cannot widen any bound: the narrowing rule is enforced server-side and again at the issuer via spending controls. It cannot self-authorize a tab (the ceremony requires the user's passkey) and cannot approve its own step-ups (the Tap requires a fresh passkey assertion from the tab owner). Budget accounting is atomic; no sequence of concurrent requests can exceed the root total. Every request, decision, and refusal lands in an append-only audit log.

**Not guaranteed:** An injected agent can still spend inside its bounds on attacker-preferred merchandise within the allowed merchant set, until a policy trigger fires or the user revokes the tab. Bounds and step-up policy are the user's blast-radius dial; a permissive tab yields a larger worst case.

### 6.2 Stolen child mandate or card payload

Card details transit to the agent once at purchase time and are never stored by the TA.

**Guaranteed:** A stolen instrument is worth at most the mandate amount at the mandated merchant category, and only until first settlement or TTL expiry, whichever comes first. Issuer spending controls enforce this independently of the TA (defense in depth: a TA bug does not disable the card limits). A stolen but unused instrument dies on its own within minutes.

**Not guaranteed:** Within its narrow window and bounds, a stolen instrument spends like any card. The protocol bounds the loss; it does not make theft impossible.

### 6.3 Replayed mandate or receipt

**Guaranteed:** Child mandates are single-use: filing a receipt consumes the mandate, so no mandate can ever pay twice. The idempotency key (derived from tab, merchant, cart hash, and the hour-long window the attempt falls in, with the preceding window checked as well) additionally makes a retried invocation harmless: an agent that timed out, crashed, or was interrupted cannot turn one intended purchase into two. It deliberately does not forbid buying the same cart again later, which is an ordinary repeat purchase rather than a double-order. WebAuthn assertions cannot be replayed across contexts, because every signature binds to a specific challenge: the ceremony challenge is the hash of the exact bounds, the Tap challenge is the hash of the exact amendment. Signature counters detect cloned authenticators. Receipts are dual-signed and tamper-evident: change one byte and verification fails.

**Not guaranteed:** Replay protection covers protocol objects. It does not cover a merchant that ships twice for one order.

### 6.4 Malicious merchant page

The merchant is untrusted and deliberately a non-party.

**Guaranteed:** The preflight/commit protocol reads the final cart total, currency, and line items from the checkout page and refuses to commit on any mismatch with the mandate; a surprise fee aborts before card entry. Evidence (DOM hash, screenshot hash) is captured at the commit moment and referenced by the receipt. A merchant that overcharges beyond the per-authorization limit is declined by the issuer.

**Not guaranteed:** A merchant can lie about fulfillment, ship nothing, or misdescribe goods. Molt proves what was authorized and what the checkout page claimed at commit time; it does not guarantee post-purchase outcomes (see section 7).

### 6.5 Malicious or compromised Tab Authority

Anyone can self-host a TA, so the TA itself must be assumed attackable.

**Guaranteed:** The TA never holds funds, so there is nothing to steal from it beyond scoped test instruments. It cannot forge the user's authorization: mandate bounds are bound to a passkey assertion whose challenge is the hash of those exact bounds, so a TA that silently edits stored bounds produces a detectable mismatch (`GET /api/tabs/:id/binding`, `molt verify`). Receipts countersigned by a TA remain independently verifiable offline.

**Not guaranteed:** A fully malicious TA can refuse service, leak metadata it processes (merchants, amounts, task declarations), or mint instruments up to the user's signed bounds. Choosing a TA operator is choosing a custodian of authorization, not of money; the audit trail makes misbehavior evident after the fact, not impossible.

### 6.6 Intercepted step-up email

**Guaranteed:** The approval link alone approves nothing. Approval requires a passkey assertion from the tab owner with user verification; an attacker holding the email can at most deny the purchase, which only narrows authority. Step-up requests expire after 15 minutes.

**Not guaranteed:** Email interception can leak purchase metadata (merchant, amount, reason).

## 7. What Molt deliberately does not do

These are design commitments, not roadmap gaps. Several of them are load-bearing for the regulatory position described below.

- **No bot-detection evasion.** All automated requests are signed and honestly identified (section 4.4). No fingerprint spoofing, no CAPTCHA solving, no stealth of any kind. Merchants that block agents get an honest `blocked_by_merchant` failure, and that is the intended behavior. Coverage comes from graded execution, not from deception.
- **No funds custody.** The Tab Authority never holds, receives, or forwards money. All money movement in the reference deployment consists of Stripe test-mode API calls.
- **No payment initiation.** The TA authorizes and scopes. Execution happens on issuer rails when the agent uses the scoped card at a merchant. The TA never itself pushes a payment.
- **No SCA performance.** The passkey ceremony authenticates the user to Molt for mandate signing only. It is not strong customer authentication under PSD2, no issuer may rely on it as such, and Molt documentation will never claim otherwise. Where a real-money issuer requires SCA, that challenge belongs to the issuer, not to Molt.
- **No crypto custody or conversion.** The v1 x402 rung uses agent-operator-owned local wallets with testnet USDC only. The TA sees addresses and receipts, never key material.
- **No post-purchase state guarantees.** Molt proves authorization and commit-time evidence. Delivery, quality, refunds, and disputes remain between the user and the merchant, on the merchant's ordinary terms.
- **No ToS dissolution.** Using an agent does not change the user's obligations to merchants. Molt identifies its traffic precisely so merchants can make their own decision.

**Regulatory positioning, in plain words:** Molt is technical infrastructure. Because the TA never holds funds, never initiates payments, never performs authentication on an issuer's behalf, and never custodies crypto-assets, the reference implementation is designed to operate as a technical service provider rather than a regulated payment institution. The hosted beta is test-mode only; no real money moves. Self-hosters who connect a live issuer relationship operate that relationship themselves and are responsible for their own compliance. None of this document is financial or legal advice.

## Appendix A. AP2 compatibility

AP2 (the Agent Payments Protocol) standardizes cryptographic proof that a human authorized an agent's spending: Intent Mandates capture the delegated task and its limits, Cart Mandates capture the exact cart the agent is about to pay for. Molt operates at an adjacent layer: it specifies how bounded authority is delegated, narrowed, and executed against merchants that participate in no protocol at all. The layers are complementary, and Molt intends to publish an AP2-compatible mandate profile once the mapping below stabilizes.

### A.1 Field mapping

| Molt concept                                              | AP2 concept                              | Notes                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Root mandate (the Tab)                                    | Intent Mandate                           | Task declaration, budget, expiry, and scope, signed by the user up front.                                     |
| `task_declaration`                                        | Intent Mandate natural-language intent   | Same role: binds purchases to a human-stated goal.                                                            |
| Root `bounds.expires_at`                                  | Intent Mandate expiry                    | Direct equivalent.                                                                                            |
| Root ceremony (WebAuthn, challenge = bounds hash)         | User authorization of the Intent Mandate | Both bind a human credential to exact terms; encodings differ (WebAuthn assertion vs. verifiable credential). |
| Child mandate                                             | Cart Mandate                             | One merchant, one cart, one amount, short TTL.                                                                |
| `cart_hash`                                               | Cart Mandate cart contents               | Molt hashes the normalized cart; AP2 carries the cart itself.                                                 |
| The Tap (amendment assertion)                             | Human-present authorization              | Both produce fresh user proof for an unusual purchase.                                                        |
| Receipt (`mandate_chain`)                                 | Mandate audit trail                      | Both link settlement evidence back to the authorizing mandates.                                               |
| `mcc_allowlist`, `velocity_per_hour`, `merchant_denylist` | No direct equivalent                     | Molt bounds with no AP2 counterpart today; a profile would carry them as extensions.                          |
| Ladder rung / provenance                                  | No direct equivalent                     | AP2 assumes participating counterparties; Molt declares how execution happened at non-participating ones.     |

### A.2 Open questions

Tracked as GitHub issues so the discussion is public:

1. Encoding: can a Molt root/child mandate be expressed losslessly as an AP2 Intent/Cart Mandate pair (verifiable-credential encoding of WebAuthn-bound documents)?
2. Does the Tap amendment map cleanly to AP2 human-present authorization semantics?
3. How should Molt bounds without AP2 equivalents (MCC allowlist, velocity, denylist) travel in an AP2-compatible profile?
4. Revocation: Molt tabs are revocable server-side at any time; what is the equivalent lifecycle signal in AP2?
