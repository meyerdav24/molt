# Molt — v1 build roadmap

## Context for implementers (read first — this file is self-contained)

> Public variant of the build plan: implementer context and tickets. Internal planning notes live in the private companion repo.

**What Molt is:** an open protocol (Apache 2.0) that lets a human safely delegate bounded, autonomous spending authority to an AI agent — and lets that agent order and pay at **any online store, including the overwhelming majority that expose no agentic commerce protocol whatsoever**. The name is the security model: crustaceans molt — shed a shell, grow a fresh one. In Molt, the agent never holds the user's real card; for every single purchase it grows a fresh, disposable **shell** (a single-use scoped card or a one-shot signed payment) sized exactly to that cart, worn once, and shed immediately. "The agent molts after every purchase" is the blast-radius claim in one sentence. The user-flow metaphor is a bar tab: show ID once, open a tab with a limit, anything unusual gets checked with you. Both metaphors are load-bearing in copy: **molting/shells** names the per-purchase disposable credential, **the tab** names the delegation ceremony and bounds. "Shell" may be used informally in copy and UI as the friendly word for a child-mandate-scoped payment instrument; in the spec and code, the formal terms remain child mandate and card/payment payload.

**Naming rules:** project/repo/CLI name is **Molt** / `molt` (TODO-HUMAN before OT-001: verify domain availability — molt.dev or .sh — and scan for product-name collisions; fallback name if blocked: **Stipend**). The protocol primitive remains **the Tab** (users "open a tab") — that is in-protocol vocabulary, not branding. Never use the name "OpenTab" anywhere: trademark-adjacent to OpenTable.

**The one-sentence positioning:** every existing protocol standardizes how merchants accept agents (ACP, UCP) or how machines settle (x402, MPP); Molt is the first open standard for the _delegation_ layer — recursive, bounded, auditable spending authority that works against merchants who never agreed to anything.

**The three-party model (the merchant is deliberately NOT a party):**

```
User ──(one passkey ceremony)──> Tab Authority ──(scoped credentials)──> Agent ──> any merchant
                                      │
                                      └── receipts, audit log, step-up channel
```

- **Tab Authority (TA):** the only new infrastructure. Verifies mandates, enforces policy, requests scoped payment instruments from an issuer API, countersigns receipts. **Never holds funds, never initiates payments.** Anyone can self-host it; this repo is the reference implementation.
- **Agent:** anything that speaks the TA's REST API — in practice Claude via the MCP server built here.
- **Merchant:** treated as an untrusted, read-only surface. Installs nothing, agrees to nothing, sees an ordinary card transaction.

**The five protocol primitives (use these names consistently in code, spec, and docs):**

1. **The Tab** — a root mandate: one WebAuthn (passkey) ceremony signs a JSON object of bounds (total budget, per-tx max, expiry, merchant-category allowlist, velocity, step-up policy, free-text task declaration). Every purchase derives a **child mandate** from it. The **narrowing rule** is the core invariant: _a child can never exceed its parent on any dimension_ — amount, expiry, scope. Children are scoped to one merchant, one cart hash, one amount, ~15-minute TTL. Security claim that everything rests on: **a fully compromised agent can spend at most one outstanding child mandate before anomaly triggers fire.**
2. **The Ladder** — graded merchant execution with declared provenance: L0 native protocol (x402 real; ACP/UCP stubbed), L1 deterministic platform adapter (Shopify), L2 general browser automation (Stagehand), L3 hand a deep link back to the human. Every receipt records which rung executed.
3. **The Stamp** — identity over stealth, absolute rule: all automated requests carry RFC 9421 HTTP Message Signatures plus a `Tab-Context` header (TA-countersigned child-mandate hash), honest user-agent string. **Zero stealth measures ever** — no fingerprint spoofing, no CAPTCHA solving. If blocked, fail honestly.
4. **The Receipt** — normalized, dual-signed (agent + TA) record: rung, rail, merchant, amount, evidence hashes (DOM + screenshot), idempotency key, mandate-chain reference. Identical shape whether payment went through a card or on-chain. Verifiable offline via the `molt verify` CLI.
5. **The Tap** — asynchronous step-up: policy-triggered purchases hold until the user approves via a passkey assertion (v1: email link → mobile web page). The tap signs an _amendment_ to the tab, never a new root.

**Payment rails in v1 (both test-money only):** (a) child mandate → single-use Stripe Issuing **test-mode** virtual card with spending_controls mirroring the mandate — this is how "any store" works, since the merchant just sees a normal card; (b) x402/USDC on **Base Sepolia testnet** from an agent-operator-owned local wallet, for machine-to-machine payments and the demo's earn-and-spend loop.

**Why the guardrails exist (G1–G4 below):** the entire architecture is _unregulated by construction_ under EU payment law (PSD2/ZAG/MiCA). The TA is a technical service provider — the moment it holds funds, initiates payments, performs authentication on an issuer's behalf, or custodies crypto, it becomes a licensed financial institution. Guardrails are product requirements, not legal decoration; when a ticket conflicts with a guardrail, the guardrail wins and the ticket changes.

**What "done" means:** a Show-HN-ready launch — public repo a stranger self-hosts in 10 minutes, a ≤2-minute demo video per the storyboard in OT-092, docs, and a hosted test-mode beta. The demo's dramatic arc (three autonomous purchases → one caught by policy → phone tap → verifiable receipts) is the product argument; build quality priorities follow from it.

**Style notes:** prose and docs in direct, concise English; no em dashes in user-facing copy; no hype language; the "what Molt deliberately does not do" honesty section is a feature, keep it prominent.

---

**Goal:** A publishable, Show-HN-ready version of Molt: spec + reference Tab Authority + MCP server + one working checkout adapter + demo video + docs. Entirely test-mode. Zero regulated activity.

**Definition of "perfect v1":** A stranger can clone the repo, run `docker compose up`, open a tab with a passkey, and watch an agent buy something on a Shopify dev store with a scoped sandbox card — and every purchase produces a dual-signed receipt.

**Explicit non-goals for v1 (backlog):** live-money hosted service, benchmark suite, push-notification step-up, WooCommerce/Magento adapters, enterprise features. **Pulled into v1:** the x402 L0 rung (Epic 11) with a testnet-only stablecoin path. Stablecoin-backed cards remain a conditional stretch (OT-114), gated on Stripe approval timing.

---

## Regulatory guardrails (read before every epic)

These four rules keep the entire project outside PSD2/ZAG/MiCA scope. Every ticket must respect them.

- **G1 — No funds flow through Molt.** The TA never holds, receives, or forwards money. All money movement is Stripe test-mode API calls. No real Stripe live keys anywhere in the codebase, CI, or hosted beta.
- **G2 — No payment initiation by the TA.** The TA authorizes and scopes (mints mandates, requests card creation via issuer API). Execution happens on issuer rails when the agent uses the card at a merchant. The TA never itself pushes a payment.
- **G3 — No SCA performed for third parties.** The passkey ceremony authenticates the user _to Molt_ to sign a mandate. Documentation must never claim the ceremony satisfies SCA or that issuers may rely on it as authentication.
- **G4 — No custody or conversion of crypto-assets.** The TA never holds keys, wallets, or crypto balances. The v1 x402 rung (Epic 11) uses **agent-operator-owned local wallets with testnet USDC only** in hosted mode; the TA sees addresses and receipts, never key material. Mainnet stablecoin flows and conversion stay behind licensed enablers (OT-114 and backlog).

---

## Technical inventory — what you are actually building

One **monorepo** (GitHub, Apache 2.0, pnpm workspaces) containing everything below. There is no separate "website project" — the site, dashboard, and API are one Next.js app.

| Deliverable                                                                                       | Where                     | Stack                                                                                               | Built by               |
| ------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| **Web app** — landing page, docs, dashboard, step-up page, TA REST API (`/v1/`), Stripe webhooks  | `apps/web`                | Next.js 14+ (App Router, TS), Tailwind, SimpleWebAuthn, Stripe SDK; docs via Fumadocs/Nextra routes | Epics 2, 3, 7, 8, 9    |
| **MCP server** — the 4 agent tools                                                                | `apps/mcp-server`         | Node/TS, MCP SDK, stdio + SSE                                                                       | Epic 4                 |
| **Demo x402 seller** — paid API + buyer script                                                    | `apps/demo-seller`        | Node/TS, x402 middleware                                                                            | OT-113                 |
| **Protocol package** — JSON schemas, mandate-tree engine, receipt signing, `molt verify` CLI      | `packages/protocol`       | Pure TS, zero runtime deps where possible; the most-tested code in the repo                         | OT-010, OT-022, OT-060 |
| **Adapters package** — platform detector, Shopify L1, Stagehand L2, preflight, Stamp, x402 client | `packages/adapters`       | Playwright, Stagehand, RFC 9421 signing                                                             | Epic 5, OT-110/111     |
| **Spec** — the protocol document                                                                  | `SPEC.md` + `/docs` route | Markdown, JSON Schema files                                                                         | Epic 1                 |
| **Demo kit** — storyboard, seed data, reset script, final video/GIF/stills                        | `demo/`                   | Scripts + assets                                                                                    | OT-092, OT-095–097     |
| **Ops** — docker compose, CI, migrations                                                          | root, `supabase/`         | Docker, GitHub Actions, Supabase CLI                                                                | Epic 0                 |

**External services (all free/test tier):** Supabase (EU region — DB, RLS, auth storage), Stripe (test mode + Issuing sandbox; live application submitted day 1 but unused), Vercel or a small VPS for the hosted beta, Resend/Postmark (step-up emails), 2–3 Shopify dev stores, Coinbase x402 facilitator + Base Sepolia faucet (testnet), Plausible or nothing (analytics), a domain.

**What does not exist in v1:** no mobile app (step-up is a mobile web page), no separate marketing site, no Python services, no Kubernetes, no live Stripe keys, no mainnet.

### Open-source boundary (determines repo structure — decide once, day 1)

**Two repositories from the first commit:**

1. **`molt` (public, Apache 2.0)** — the entire monorepo above: spec, protocol package, reference TA (`apps/web` including dashboard), MCP server, adapters, demo seller, demo kit, docker compose, CI, migrations. Rule: _everything needed to implement, verify, and self-host the protocol is public._ Nothing proprietary ever touches this repo — code that enters public git history cannot be un-published without history surgery.

2. **`molt-cloud` (private)** — the operated business. In v1 this is nearly empty: hosted-instance infra config (Vercel/VPS setup, env management, rate-limit tuning, abuse rules), production secrets references, legal docs. It grows post-launch into: enterprise control plane (BL-10 — team policies, SSO, DATEV export, built _against_ the public TA API, never as a fork), the registry/Stamp verification service (BL-08), billing, and aggregated production data. Rule: _everything involved in operating at scale with trust and real money is private._

**Boundary cases, decided now:** benchmark _harness_ (BL-01) → public (reproducibility is its authority); ongoing production _dataset_ → private. Stamp _format_ → public spec; operated _registry_ → private service. Storyboard + demo assets → public (they're launch marketing).

**Governance pre-commitment (goes in the public README, OT-093):** spec + reference implementation are Apache 2.0 permanently; intent to move spec governance to a neutral home once independent implementations exist (MCP/Linux Foundation pattern). Public commitment: no relicensing of the open project — defensibility lives in the operated registry and data, not the license. (Internally: the DCO requirement in OT-001 preserves legal optionality anyway; the public commitment is the binding one for community trust.)

---

## EPIC 0 — Project foundation

### OT-001 · Repos + monorepo scaffold

Create **two repos** per the open-source boundary above: `molt` (public from first commit — build in the open) and `molt-cloud` (private, holds only hosted-instance infra config in v1). In `molt`, set up a pnpm monorepo: `apps/web` (Next.js 14+ App Router, TypeScript), `apps/mcp-server` (Node/TS), `apps/demo-seller` (Node/TS), `packages/protocol` (shared types + validation), `packages/adapters` (checkout automation). ESLint, Prettier, strict TS. LICENSE (Apache 2.0), `CONTRIBUTING.md` stub noting adapters as the contribution on-ramp **and requiring DCO sign-off on all external contributions (enforce via DCO bot / `--signoff` check in CI) — this must exist before the first outside PR merges; it preserves licensing optionality forever and costs contributors one git flag.**

- **AC:** `pnpm build` passes clean from fresh clone; CI runs lint + typecheck on PR **and rejects unsigned commits from non-team contributors**; secret-scanning enabled on both repos; a grep of `molt` history finds zero deployment secrets or proprietary references; **`PLAN.md` is in the public repo's `.gitignore` from the first commit** (it stays a local working file for Claude Code; canonical copy lives in `molt-cloud`), so private planning notes never enter public history.
- **Est:** 3 h · **Deps:** none

### OT-002 · Supabase project + schema v1

Provision Supabase (EU region — GDPR hygiene from day one). Tables: `users`, `credentials` (WebAuthn), `tabs`, `mandates` (self-referencing parent_id for the tree), `cards`, `receipts`, `events` (append-only audit log). Row-level security on all tables.

- **AC:** Migrations in repo (`supabase/migrations`); RLS policies tested; `events` table is insert-only for app role.
- **Est:** 3 h · **Deps:** OT-001

### OT-003 · Docker compose for self-hosters

One-command local run: web app + MCP server + local Supabase (or documented cloud setup). `.env.example` with every variable explained, including `OPEN_TAB_MODE=test` (see OT-060).

- **AC:** Fresh machine → `docker compose up` → working app in under 10 min following README only.
- **Est:** 3 h · **Deps:** OT-001, OT-002

### OT-004 · Stripe test account + Issuing sandbox access

Create Stripe account, enable Issuing in test mode, store restricted test key. **Same day: submit application for live Issuing access** (needed post-launch, review takes time; not used in v1).

- **AC:** Can create a test cardholder + virtual card via API from local env.
- **Est:** 1 h · **Deps:** none

---

## EPIC 1 — Protocol specification

### OT-010 · Spec document: core concepts + data model

Write `SPEC.md` (versioned, `v0.1-draft`): terminology (Tab, Root Mandate, Child Mandate, Tab Authority, Ladder, Stamp, Receipt, Tap), the three-party model, explicit merchant-as-non-party principle, and the JSON schemas for every object. Include the narrowing rule as normative MUST language: _a child mandate MUST NOT exceed its parent on any bound (amount, expiry, merchant scope, MCC, velocity)._

- **AC:** Every field in the schemas has a description; schemas exported as JSON Schema files in `packages/protocol`; a reviewer can implement a compatible TA from the doc alone.
- **Est:** 6 h · **Deps:** none (parallel to build)

### OT-011 · Spec section: threat model

Document the adversary model explicitly: prompt-injected agent, stolen child mandate, replayed mandate, malicious self-hosted TA, malicious merchant page. For each: what the protocol guarantees, what it doesn't. State blast-radius claim precisely: _compromise of the agent between step-up events is bounded by the outstanding child mandate(s)._

- **AC:** Section answers the top 5 predictable HN objections before they're asked; reviewed by at least one security-minded friend.
- **Est:** 4 h · **Deps:** OT-010

### OT-012 · Spec section: what Molt deliberately does not do

The honesty section (verbatim candidates from design discussion): no bot-detection evasion, no funds custody, no SCA performance, no post-purchase state guarantees, no ToS dissolution. Plus the regulatory-positioning paragraph (TSP stance, G1–G4).

- **AC:** Section exists, is linked from README top, and is written in plain language.
- **Est:** 2 h · **Deps:** OT-010

### OT-013 · AP2 compatibility note

Short appendix mapping Molt mandate fields to AP2 Intent/Cart Mandate concepts; declare intent to publish an AP2-compatible profile. (Positioning: interop with the authorization layer, differentiation on merchant-free execution.)

- **AC:** Field-mapping table complete; open questions listed as GitHub issues.
- **Est:** 3 h · **Deps:** OT-010

---

## EPIC 2 — Tab Authority core

### OT-020 · WebAuthn registration + login

Passkey-only auth using SimpleWebAuthn. Registration (resident key, platform authenticator preferred), login, session management (short-lived JWT + refresh). No passwords anywhere.

- **AC:** Works on iOS Safari, Android Chrome, macOS Chrome/Safari, Windows Chrome (manually tested on real devices — budget the fiddling time); credentials stored per OT-002 schema.
- **Est:** 6 h build + 4 h device testing · **Deps:** OT-002

### OT-021 · Open Tab ceremony (root mandate)

UI flow: user sets bounds — total amount, per-tx max, expiry, MCC allowlist (curated human-readable categories mapped to MCC codes), optional merchant denylist, velocity limit, free-text task declaration, step-up policy (per-trigger: allow / notify / require_tap / block). Submission triggers a **fresh WebAuthn assertion** whose challenge is the SHA-256 hash of the canonical mandate JSON — the signature binds the passkey ceremony to these exact bounds.

- **AC:** Root mandate stored with assertion + challenge; tampering with stored bounds is detectable by re-verifying assertion against recomputed hash; ceremony completes in < 30 s of user time.
- **Est:** 8 h · **Deps:** OT-020, OT-010 (schema)

### OT-022 · Mandate tree engine + narrowing validator

Server-side module (in `packages/protocol`, pure functions, heavily unit-tested): mint child mandate from parent; validate narrowing on every dimension; decrement parent remaining-budget atomically (Postgres transaction / row lock — no double-spend under concurrent requests); TTL enforcement (child default 15 min); machine-readable `reason` field linking child to task declaration.

- **AC:** ≥ 25 unit tests including adversarial cases (child > parent on each bound, expired parent, concurrent minting race, budget exactly exhausted); property-based test that no sequence of mints can exceed root total.
- **Est:** 8 h · **Deps:** OT-002, OT-010
- **This is the most important code in the project. Do not rush it.**

### OT-023 · Policy engine + step-up triggers

Evaluate each child-mandate request against the tab's step-up policy: unknown merchant (not seen in this tab before), amount > per-tx max fraction or > rolling baseline, MCC outside allowlist, velocity exceeded. Outcomes: auto-approve / notify / hold-for-tap / block. Every decision written to `events` with full reasoning.

- **AC:** Each trigger covered by tests; a held mandate is unusable until approved; decisions visible in dashboard event log.
- **Est:** 5 h · **Deps:** OT-022

### OT-024 · The Tap v1: email-link step-up

When policy says `require_tap`: email the user (Resend/Postmark) with purchase summary + approve/deny links. Approve link opens a page requiring a **WebAuthn assertion** (not just the click — the link alone must not approve) that signs an amendment to the tab; deny cancels the child mandate. 15-min expiry on the request.

- **AC:** Full loop works on mobile email → passkey tap → agent's pending purchase proceeds; deny path tested; expired requests auto-cancel.
- **Est:** 5 h · **Deps:** OT-023, OT-020
- **Backlog note:** replace with push notifications post-launch.

### OT-025 · TA REST API

Versioned HTTP API (`/v1/`): `POST /tabs` (returns ceremony URL), `GET /tabs/:id`, `POST /tabs/:id/mandates` (request child), `GET /mandates/:id`, `POST /mandates/:id/receipt`, `GET /tabs/:id/receipts`. API-key auth for agents (scoped per tab, revocable). OpenAPI spec generated and committed.

- **AC:** OpenAPI doc renders; all endpoints have integration tests; agent keys can be rotated from dashboard.
- **Est:** 6 h · **Deps:** OT-022, OT-023

---

## EPIC 3 — Payment rail (Stripe Issuing, test mode)

### OT-030 · Cardholder provisioning

On first tab creation, create Stripe test cardholder for the user (test-mode data; no real KYC in v1 — document that live mode delegates KYC to issuer, per guardrails).

- **AC:** Cardholder created idempotently; ID stored on user record.
- **Est:** 2 h · **Deps:** OT-004, OT-021

### OT-031 · Child mandate → scoped virtual card

On approved child mandate: create Stripe virtual card with `spending_controls` mirroring the mandate — `spending_limits` (per-authorization = mandate amount), `allowed_categories` (MCC), and deactivate-after-use + TTL via scheduled job. Card details returned to the agent **once**, never stored in plaintext (store Stripe card ID only; retrieve details via Stripe API at time of use).

- **AC:** Card limits verifiably match mandate in Stripe dashboard; card unusable after TTL or first settled authorization; card details never appear in DB or logs.
- **Est:** 6 h · **Deps:** OT-022, OT-030

### OT-032 · Stripe webhooks: authorization + transaction events

Consume `issuing_authorization.request/created`, `issuing_transaction.created`. Real-time authorization webhook: approve only if an active matching child mandate exists (second enforcement layer beyond card limits — defense in depth). Write all events to `events`; link settled transactions to receipts.

- **AC:** Authorization without matching active mandate is declined in test; webhook signature verification enforced; retries idempotent.
- **Est:** 5 h · **Deps:** OT-031

---

## EPIC 4 — MCP server

### OT-040 · MCP server with four tools

Tools: `open_tab` (returns ceremony URL for the human — agent cannot self-authorize), `resolve_merchant(url)` (v1: detect Shopify vs unknown; return ladder rung), `purchase(tab_id, merchant_url, items|cart_url, max_amount)` (requests child mandate → gets card → invokes adapter → files receipt; returns receipt or step-up-pending status), `get_receipts(tab_id)`. Clear tool descriptions written for LLM consumption. Stdio + SSE transports.

- **AC:** Works end-to-end from Claude Desktop config with copy-paste snippet from README; step-up-pending path returns actionable message to the agent ("user approval requested via email").
- **Est:** 6 h · **Deps:** OT-025, OT-031, Epic 5

### OT-041 · MCP hardening

Timeouts, structured errors, no card details in tool responses beyond what the adapter needs in-memory, rate limiting per API key, audit log entry per tool call.

- **AC:** Deliberately malformed calls fail safely with useful errors; fuzz session finds no crash.
- **Est:** 3 h · **Deps:** OT-040

---

## EPIC 5 — Checkout automation (the Ladder, v1 = L1 Shopify + L2 fallback)

### OT-050 · Shopify dev-store test bed

Create 2–3 Shopify development stores with varied themes/products, Stripe test gateway (or Shopify Bogus Gateway where card flow allows). These are the demo + test environment.

- **AC:** Manual test-card checkout succeeds on all stores; store URLs in repo test config.
- **Est:** 3 h · **Deps:** none

### OT-051 · Platform detector

Given a URL: fetch homepage + probe well-known paths; classify Shopify / unknown; return rung recommendation. ACP/UCP endpoint probing wired as stubs returning `not_found`; **x402 probing is real** (delegates to OT-111's detection).

- **AC:** Correctly classifies 10 known Shopify stores + 10 non-Shopify sites; result cached; recorded in receipt.
- **Est:** 4 h · **Deps:** OT-001

### OT-052 · L1 Shopify adapter (deterministic)

Playwright script: add specified items to cart → proceed to checkout → fill shipping (from tab profile) → enter scoped card → confirm → capture order confirmation (order number, DOM snapshot, screenshot). Handle common variants: single-page vs multi-step checkout, required account prompts (fail gracefully), out-of-stock (abort before payment, report).

- **AC:** ≥ 90 % success across 20 consecutive runs on the 3 dev stores; on any failure, no charge attempted or card immediately deactivated; failure reasons structured.
- **Est:** 10 h (iteration-heavy) · **Deps:** OT-050, OT-031

### OT-053 · L2 general fallback (Stagehand)

Natural-language-driven fallback for non-Shopify sites: attempt checkout via Stagehand/vision. Explicitly marked experimental; hard preflight gate (OT-054) before any card entry; single retry then hand back L3 deep-link to human.

- **AC:** Completes checkout on ≥ 1 non-Shopify test store; never enters card without passing preflight; graceful L3 handoff message.
- **Est:** 8 h · **Deps:** OT-052 (shares infra)

### OT-054 · Preflight + commit protocol

Before card entry on any rung: extract final cart total, currency, line items, shipping cost from checkout page; validate against child mandate amount and task declaration (LLM check with strict rubric); generate idempotency key from (tab, merchant, cart-hash); refuse commit on any mismatch or if idempotency key already used. Capture DOM-hash + screenshot at commit moment as evidence.

- **AC:** Price-mismatch test (dev store with surprise fee) aborts correctly; double-invocation with same cart never double-orders; evidence artifacts stored + hashed.
- **Est:** 6 h · **Deps:** OT-052

### OT-055 · The Stamp: signed requests

All adapter HTTP traffic carries RFC 9421 HTTP Message Signatures with the TA's registered agent key, plus `Tab-Context` header (TA-countersigned child-mandate hash). Honest UA string identifying Molt agent + repo URL. **No stealth measures anywhere: no fingerprint spoofing, no CAPTCHA solving.** If blocked → structured `blocked_by_merchant` failure, surfaced honestly.

- **AC:** Signatures verifiable with published test vector; grep confirms zero stealth libs in deps; blocked path returns clean failure not retry-loop.
- **Est:** 4 h · **Deps:** OT-052

---

## EPIC 6 — Receipts

### OT-060 · Receipt object + dual signing

Implement normalized receipt per spec: rung, rail, merchant, amount, evidence hashes, idempotency key, mandate chain reference. Signed by agent key + countersigned by TA key. Verification CLI (`npx molt verify receipt.json`) shipped in `packages/protocol`.

- **AC:** Round-trip sign→verify passes; tampered receipt fails verification; CLI works from clean install.
- **Est:** 4 h · **Deps:** OT-054, OT-032

### OT-061 · Order-email reconciliation (best effort)

Optional: user forwards order confirmations to a per-tab inbound address; parser links email to receipt by merchant + amount + time window; receipt status upgraded to `merchant_confirmed`.

- **AC:** Works for Shopify confirmation emails; unmatched emails queued visibly, never guessed.
- **Est:** 4 h · **Deps:** OT-060 · **Cuttable if time-pressed — mark experimental.**

---

## EPIC 7 — Dashboard (deliberately boring)

### OT-070 · Tab overview + receipt log

Pages: tab list (status, remaining budget, expiry), tab detail (bounds, spend progress, mandate tree visualization, receipt list with evidence links, event log), agent API key management. Clean, minimal, fast. No marketing inside the app.

- **AC:** Every mandate and receipt from a demo run is inspectable end-to-end in the UI; mobile-usable (step-up flow lands here).
- **Est:** 8 h · **Deps:** OT-025, OT-060

### OT-071 · Step-up approval page

The page the email link opens: purchase summary (merchant, amount, items, why it triggered), approve-with-passkey / deny. Optimized for a 10-second mobile interaction.

- **AC:** Full flow < 15 s on a phone; deny is one tap.
- **Est:** 3 h · **Deps:** OT-024, OT-070

---

## EPIC 8 — Test-mode enforcement + legal hygiene (the "never regulated" epic)

### OT-080 · Hard test-mode gate

`OPEN_TAB_MODE=test` is the only mode the hosted beta and default config support. Code path validates every Stripe key starts with `sk_test_`/`rk_test_` at boot and refuses to start otherwise. Live mode requires an explicit compile-time-documented flag intended for self-hosters who bring their own issuer relationship.

- **AC:** App refuses to boot with a live-shaped key in default mode; test covering the gate.
- **Est:** 2 h · **Deps:** OT-004

### OT-081 · Disclaimers + positioning text

README + landing + docs footer: (1) hosted beta is test-mode only, no real money moves; (2) self-hosters operate their own issuer relationship and are responsible for their own compliance; (3) Molt is technical infrastructure — it never holds funds, never initiates payments, never performs SCA (G1–G3 in plain words); (4) not financial or legal advice.

- **AC:** Text present in all three locations; reviewed once by a lawyer-adjacent reader for obvious own-goals.
- **Est:** 2 h · **Deps:** none

### OT-082 · GDPR baseline

Privacy policy (data collected: account, mandates, receipts, evidence artifacts; EU hosting; retention; deletion on request). Account-deletion flow that actually cascades (mandates/receipts anonymized, evidence purged). No third-party analytics with personal data in v1 (Plausible or nothing).

- **AC:** Deletion tested end-to-end; policy linked from footer.
- **Est:** 3 h · **Deps:** OT-002

---

## EPIC 9 — Docs, site, launch assets

### OT-090 · Documentation site

Docs (Fumadocs/Nextra inside `apps/web` or separate): Quickstart (self-host in 10 min), Claude Desktop / MCP setup, API reference (from OpenAPI), spec (rendered), architecture diagram (three parties, merchant outside the box), FAQ seeded with the predictable HN questions (prompt injection → narrowing tree; ToS → identity-over-stealth; "why not just ACP" → coverage; regulation → Epic 8 story).

- **AC:** A developer who has never spoken to you reaches a working demo purchase from docs alone (test with one CDTM friend, timed).
- **Est:** 8 h · **Deps:** everything above

### OT-091 · Landing page

One page: molt-cycle explanation up top (per OT-098 vocabulary — grow, wear once, shed), 90-second demo video embedded, "how it works" diagram, the honest non-goals section, GitHub + docs links, waitlist capture for hosted live mode (see OT-121), and a single quiet **Pricing** link rendering the three-line block from OT-120 — no feature matrix, no tables.

- **AC:** Loads fast, reads clean on mobile, zero hype-words you'd cringe at in 6 months; pricing block is exactly three lines.
- **Est:** 4 h · **Deps:** OT-097, OT-098, OT-120

### OT-092 · Demo storyboard + script (shot-by-shot)

Write the exact storyboard before touching a camera. The **molt storyline** (OT-098) is the narrative spine: shells grown, worn once, shed. Locked scene list (timestamps approximate, total ≤ 2:00):

- **0:00–0:05 · Cold open / claim.** Text card: _"An AI agent is about to earn money, then spend it — at stores that have never heard of AI agents. It never touches a real card. It grows a disposable shell for every purchase, and sheds it."_ No logos, no music swell.
- **0:05–0:20 · Earn loop (only if Epic 11 landed).** Split screen: left, a terminal running the buyer script paying the OT-113 endpoint 3× (visible 402 → payment → 200 responses); right, the agent wallet balance ticking up in the dashboard. Caption: _"testnet USDC — play money, real protocol."_ One outgoing x402 payment from the same wallet ends the segment. **If Epic 11 slipped: cut this scene entirely; do not mention it.**
- **0:20–0:35 · The ceremony (the only human moment).** Dashboard on laptop: user sets €400 total / €150 per purchase / 1 week / categories "office & electronics" / step-up on unknown merchants. Fingerprint touch on camera (MacBook Touch ID or phone in frame). Caption: _"One approval. These exact limits are what the fingerprint signs."_
- **0:35–0:40 · The instruction.** Claude Desktop, one typed message: _"Restock the office: paper towels, printer paper, and a USB-C hub. Stay under budget."_ Hands leave the keyboard — and visibly stay out of frame for the rest of the video.
- **0:40–1:10 · Three autonomous purchases (the molt cycle, three times).** Screen recording of the agent working: `resolve_merchant` → mandate approved (dashboard event log briefly visible) → checkout fills → order confirmation page. Purchase 1 shown near-full-speed; purchases 2–3 speed-ramped with a visible elapsed-time counter (no cuts — ramp, don't hide). For one purchase, split-screen the Stripe test dashboard showing the one-time card appear with its €-limit, get used, then die — the on-screen molt. Caption sequence on that shot: _"shell grown: €34, this store only"_ → _"worn once"_ → _"shed."_ The dashboard's shell counter (OT-098) ticks 1 → 2 → 3 across the three purchases.
- **1:10–1:30 · The catch (dramatic peak).** Agent attempts a 4th purchase at an unlisted merchant / above baseline. Dashboard shows mandate **HELD** — no shell is grown. Physical phone enters the frame, notification visible, thumb tap, passkey prompt, approve. Shell appears, browser resumes and completes the order. Caption: _"No approval, no shell. Anything unusual needs a human thumb. Everything else didn't."_
- **1:30–1:50 · Proof.** Receipt log in dashboard: four receipts, rails/rungs visible, shed-shell count in the tab summary. Terminal: `npx molt verify receipt.json` → ✅. Then edit one byte of the JSON, re-run → ❌ signature invalid. This 10-second beat is non-negotiable — it's what converts "demo" into "verifiable."
- **1:50–2:00 · Close.** Text card: _"4 purchases. 4 shells grown and shed. 0 real cards exposed. The stores did nothing. Open protocol, Apache 2.0 — docker compose up and run this yourself in 10 minutes."_ GitHub URL. End.

- **AC:** Storyboard doc in repo (`demo/STORYBOARD.md`) with per-scene: screen layout, exact captions, data shown, fallback if the scene fails live; molt-storyline beats present in cold open, purchase scene, catch scene, and close; reviewed by one technical + one non-technical friend before film day.
- **Est:** 3 h · **Deps:** OT-098 (vocabulary locked first)

### OT-098 · The molt storyline (brand narrative across demo + product surfaces)

Make the name do explanatory work everywhere a viewer or user looks, so the security model teaches itself. Deliverables:

1. **Vocabulary card** (`demo/VOCAB.md`, also linked from CONTRIBUTING): the canonical metaphor sentences — _"a shell is a disposable payment credential sized to one cart"_, _"the agent molts after every purchase"_, _"no approval, no shell"_, _"worst case, an attacker gets one shell"_. Formal spec terms (child mandate, card) mapped to friendly terms; rule: shells in UI/marketing copy, formal terms in spec and code identifiers.
2. **Dashboard molt moments:** the tab detail page shows a **shell counter** (grown / worn / shed) and each receipt row carries a small shed-shell indicator; the live event log renders the lifecycle as `shell grown → worn → shed` entries. Keep it subtle — one icon and three words, not an animation festival.
3. **Verify CLI flourish:** `molt verify` success line reads `✓ receipt valid — shell was grown, worn once, and shed` (one line, no ASCII art).
4. **README + landing hook:** the first diagram is the molt cycle (grow → wear → shed) drawn around one purchase, replacing a generic architecture box as the opening visual; the architecture diagram comes second.
5. **Launch-thread asset:** one still/GIF of the Stripe dashboard card appearing and dying, captioned _"the molt"_ — this is the image version of the whole pitch and the top-comment reply asset.

- **AC:** Vocabulary card exists and is referenced by OT-090/091/093 copy tasks; dashboard shows the shell counter and lifecycle log entries in the OT-100 dry runs; `molt verify` output matches; no user-facing surface mixes metaphors (no bar-tab language where shell language belongs and vice versa: tab = the delegation, shells = the per-purchase credentials).
- **Est:** 4 h · **Deps:** OT-070 (dashboard), OT-060 (CLI); write the vocabulary card immediately in Phase 0 — it costs 30 minutes and everything downstream quotes it

### OT-095 · Demo environment + one-command reset

A `demo/` setup that makes the run repeatable and pretty: seeded dev stores with real-looking products, prices, and product photos (paper towels €12, printer paper €22, USB-C hub €34, plus the anomaly item); a demo user account with clean history; agent system prompt tuned for the task; `pnpm demo:reset` restores everything (clears tabs/receipts/events, resets store carts, refreshes wallet faucet balance) in < 60 s so failed takes cost a minute, not an evening.

- **AC:** 3 consecutive scripted runs after reset produce identical-shaped results; reset is idempotent; no leftover state ever appears in frame (old receipts, test gibberish product names).
- **Est:** 4 h · **Deps:** OT-050, OT-052, OT-100

### OT-096 · Film day + raw capture

Record per the storyboard: 1080p+ screen capture (cursor smoothing on), phone filmed physically for the tap scene (tripod or a friend), clean desktop (notifications off, single browser profile, readable font sizes — bump browser zoom to 125%). Capture every take including failures; keep one graceful failure-recovery take (e.g., out-of-stock → agent substitutes) as candidate footage — imperfection reads as real. Do **not** film until OT-052's 90%-over-20-runs criterion is green.

- **AC:** All storyboard scenes captured in at least one clean take; raw footage archived; the step-up phone shot shows notification → thumb → passkey → resume in one continuous take.
- **Est:** 4 h · **Deps:** OT-092, OT-095, OT-100 green

### OT-097 · Edit, captions, and derivative cuts

Assemble per storyboard. Captions burned in (most viewers watch muted); optional calm voiceover; visible timer on speed-ramped sections; absolutely no background-music-driven hype. Export the derivative set: **(a)** full ≤ 2:00 video (YouTube unlisted + landing embed), **(b)** 15–20 s GIF of the step-up phone-tap beat for the README, **(c)** 30 s cut ending on the verify ✅/❌ beat for the HN comment thread, **(d)** 6–8 stills (ceremony, held mandate, dead card, verify) for docs and posts.

- **AC:** Full video < 2:00; GIF < 8 MB and loops cleanly; a muted viewer can follow the entire story from captions alone; all four assets linked from the repo.
- **Est:** 5 h · **Deps:** OT-096

### OT-093 · README as front door

Structure: one-paragraph pitch (bar tab) → demo GIF → threat-model summary in paragraph two (pre-empt the injection comment) → quickstart → architecture diagram → what-it-doesn't-do → spec link → license (Apache 2.0) → disclaimers.

- **AC:** Reads well on GitHub mobile; every link works; a cold reader understands the blast-radius claim within 60 seconds.
- **Est:** 3 h · **Deps:** OT-097

### OT-094 · Show HN post + comment prep

Draft title options + post body: lead with what it does and the threat model, not vision. Prepare honest first-comment answers for: prompt injection, ToS, "Stripe will crush you", "why not AP2/ACP", regulation, "test mode = vaporware" (answer: self-host with your own issuer today; hosted live is waitlisted pending exactly the compliance work described in docs), and "how is this different from lobster.cash" (answer: open self-hostable protocol vs. hosted service; full execution ladder, not just the credential; recursive mandates with per-child blast radius; lobster-style rails could plug in as issuers). Schedule launch for a weekday morning US time.

- **AC:** Post body < 300 words; six prepared answers reviewed; a friend red-teams the thread.
- **Est:** 3 h · **Deps:** OT-093

---

## EPIC 10 — Pre-launch QA

### OT-100 · End-to-end dry runs

Five complete cold runs of the full loop (fresh user → tab → agent → purchase → step-up → receipts) on different machines/devices. Log every papercut; fix the top ten.

- **AC:** Run five completes with zero manual intervention beyond intended user actions.
- **Est:** 6 h · **Deps:** all

### OT-101 · Security pass

Checklist review: no secrets in repo/history, RLS verified, webhook signature checks, API-key scoping, card-detail handling audit (grep DB + logs), mandate-tree adversarial tests green, dependency audit, WebAuthn challenge uniqueness. **Pre-public gate: keep the full planning document in the private repo; this public roadmap is the implementer variant. Grep the public history/docs/comments for any private-planning phrasing before launch.**

- **AC:** Checklist committed to repo (`SECURITY.md`) with each item ticked; one external technical friend does a 2-hour hostile review.
- **Est:** 5 h · **Deps:** all

### OT-102 · Load sanity

Hosted beta survives an HN hug: static-cache landing + docs, rate-limit auth + API, queue-based adapter runs (one browser per purchase, bounded concurrency, honest "queued" status).

- **AC:** k6 run at plausible HN traffic passes; adapter queue degrades gracefully.
- **Est:** 4 h · **Deps:** OT-090, OT-091

---

## EPIC 11 — x402 L0 rung (pulled into v1)

**Why in v1:** makes the ladder real at L0 (native stablecoin settlement when the counterparty supports it), enables the earn-and-spend demo loop, and costs ~16 h because the protocol surface is small. **Scope discipline:** testnet USDC only in hosted mode (Base Sepolia), operator-owned wallets, guardrail G4 applies to every ticket here.

### OT-110 · x402 client

Implement the client side of x402 in `packages/adapters`: detect HTTP 402 + payment-requirements envelope; construct the signed payment payload (EIP-3009-style transfer authorization) from the agent's **local** wallet; resubmit with payment header; confirm settlement via the hosted facilitator on Base Sepolia testnet USDC.

- **AC:** Paid request round-trip succeeds against a test x402 endpoint; chain allowlist hard-codes testnet in `OPEN_TAB_MODE=test`; no private key ever transits or is logged by the TA (grep-audited).
- **Est:** 6 h · **Deps:** OT-001

### OT-111 · Ladder integration + mandate enforcement at L0

`resolve_merchant` probes for x402 support (402 response / well-known path); `purchase` routes L0 when found; child-mandate bounds enforced **client-side before signing** (payment amount ≤ mandate amount, endpoint host = mandate merchant scope); receipt records `rail: usdc_x402`, `rung: L0`, onchain tx hash as evidence. Mid-flow endpoint failure falls back to L1/L2 cleanly with the same idempotency key.

- **AC:** Over-mandate payment is refused before any signature; `molt verify` accepts receipts with tx-hash evidence; fallback path tested.
- **Est:** 4 h · **Deps:** OT-110, OT-022, OT-060

### OT-112 · Agent wallet bootstrap (non-custodial)

CLI / MCP helper generates a local wallet for the agent operator (key stored locally, encrypted at rest, never uploaded); docs walk through faucet funding with testnet USDC; custody model stated explicitly in docs: operator owns keys, the TA sees only addresses and receipts (G4).

- **AC:** Fresh user reaches a funded testnet wallet from docs alone in < 10 min; codebase grep confirms zero key material in TA app or DB.
- **Est:** 3 h · **Deps:** OT-110

### OT-113 · Demo x402 seller (the "earn" side)

Ship a trivial paid API in the repo (e.g., a quote/fortune endpoint at $0.01 testnet USDC) exposed via x402. Doubles as the integration-test target and the earn leg of the demo loop; included in docker compose so self-hosters get a working counterparty out of the box.

- **AC:** Endpoint returns a valid 402 envelope, settles via facilitator, and appears in `docker compose up`; OT-110's tests run against it in CI.
- **Est:** 3 h · **Deps:** OT-110

### OT-114 · CONDITIONAL · Stablecoin-backed card (stretch)

Build **only if** Stripe crypto-wallet Issuing approval lands ≥ 2 weekends before launch: bind a test card to a wallet via the `crypto_wallet` Issuing parameters; child mandate → scoped card funded from wallet balance; re-review G1/G4 before merge (no custody, no conversion by the TA — issuer does both). If approval hasn't landed, this ships as the first post-launch drop and its absence is mentioned nowhere in launch materials.

- **AC (if built):** Purchase on a Shopify dev store funded from the wallet-bound test card; guardrail review documented in PR description.
- **Est:** 5 h · **Deps:** OT-031, OT-112, external Stripe approval

---

## EPIC 12 — Launch-day commercialization (revenue without regulation)

**Principle for every ticket here:** monetize convenience and demand-capture, never the protocol and never money movement. Everything in the public repo stays free forever; people pay to have it _run_, _integrated_, or to _come first in line_. No guardrail (G1–G4) is touched by anything in this epic — hosted paid tiers sell SaaS infrastructure around test-mode operation, not payment services. Public rule, stated on the pricing page verbatim: _"Everything in the repo is free forever. You pay us to run it, integrate it, or come first in line."_

### OT-120 · Pricing structure + Stripe Billing (SaaS, not payments)

Define and implement exactly three tiers, rendered as three lines (no feature matrix): **Free** — self-host everything, 1 hosted tab, community support; **Hosted Dev** (€29/mo, adjust after week one) — unlimited test-mode tabs, higher API rate limits, retained receipt history, priority adapter queue, email support; **Design Partner** — "talk to us" link (OT-123). Billing via ordinary Stripe subscriptions (this is SaaS revenue, unrelated to Issuing and G1 — the paid product is infrastructure convenience for developers using the hosted TA as their staging/CI environment). Entitlement checks wired into the API-key layer (OT-025): tier limits enforced server-side.

- **AC:** A user can upgrade, downgrade, and cancel self-serve; tier limits demonstrably enforced (free user hits tab cap, paid user doesn't); pricing page copy contains the free-forever rule verbatim; zero pricing language inside the open-source docs or README beyond one neutral link.
- **Est:** 6 h · **Deps:** OT-025, OT-080

### OT-121 · Waitlist v2: demand evidence, not just emails

Upgrade the hosted-live-mode waitlist into an instrument: capture (a) email, (b) one question — _"What would your agent buy, and what is that worth to you per month?"_ (free text), (c) optional **refundable deposit tier**: €50 via a normal Stripe payment secures early access, refundable anytime, clearly labeled as a deposit for future service (not a payment service, not escrow of spending funds — it is a standard SaaS pre-order and stays G1-clean). Weekly digest of answers + deposit count to the team.

- **AC:** Deposit flow works end-to-end including self-serve refund; answers land in a queryable table; the deposit count is retrievable as one number — it is the input that triggers BL-09's legal memo (threshold suggestion: 25 deposits or 200 waitlist entries, whichever first).
- **Est:** 4 h · **Deps:** OT-091

### OT-122 · Sponsors + funding rails live before the HN post

Set up GitHub Sponsors (and Polar or Open Collective as secondary) with two or three sensible tiers; FUNDING.yml in the public repo; one restrained sponsor mention in the README footer and none anywhere else. Prepared thank-you flow for launch-day sponsors.

- **AC:** Sponsor button visible on the repo before OT-094 posts; a test sponsorship processes; no sponsor solicitation appears in docs, spec, or the Show HN post itself.
- **Est:** 2 h · **Deps:** OT-001

### OT-123 · Design-partner + services intake route

A single "Work with us" page (linked from the pricing block's third line) with two offers, each one paragraph: **Design Partner pilot** — scoped deployment of a self-hosted Molt instance in the partner's environment with _their_ issuer relationship, plus the 1–2 enterprise features they need; indicative range €10–30k, learnings feed the control plane (BL-10); and **Integration support** — day-rate help wiring Molt into an agent product. Simple intake form (company, use case, timeline, budget band) routed to email. Prepare the one-page pilot outline PDF (scope, what stays open source, IP terms sketch, "your issuer, your funds" regulatory framing) to send as first reply — draft it once now, not per-inquiry.

- **AC:** Page live at launch; intake submissions arrive reliably; pilot outline PDF exists in `molt-cloud`; the regulatory framing sentence ("the pilot runs on your issuer relationship and your funds — Molt is deployed as software") appears in both page and PDF.
- **Est:** 3 h · **Deps:** OT-091

### OT-124 · Commercial guardrails checklist (the don't-do list, enforced)

Add to `molt-cloud` a one-page commercial policy the team signs off on, and wire its checkable parts into OT-101's pre-public pass: (1) nothing ever moves from the public repo behind a paywall — features born open stay open; (2) no real-money hosted service in any tier until BL-09's legal memo exists (OT-080's test-mode gate is the technical enforcement); (3) no certification/registry fees before an actual network exists (BL-08); (4) no percentage-of-transaction pricing anywhere — flat fees only (reads as infrastructure, avoids toll optics and disintermediation pressure); (5) sponsor/pricing language never enters spec, protocol docs, or code comments.

- **AC:** Policy file exists and is linked from CLAUDE.md working conventions; OT-101 checklist includes items 1 and 5 as grep-verifiable checks.
- **Est:** 1 h · **Deps:** none

### OT-125 · CONDITIONAL · TODO-HUMAN · Trademark tripwire ("Molt")

**Do now (free, 15 min, Phase 0):** search TMview and EUIPO eSearch for "Molt" in Nice classes 9 (software), 36 (financial services), 42 (SaaS); save findings and a drafted-but-unfiled EUIPO application in `molt-cloud/legal/`. **File automatically when ANY trigger fires** (whichever comes first): (a) launch date is set, (b) public repo crosses **500 GitHub stars**, (c) first press/newsletter mention, (d) first commercial inquiry via OT-123. Filing: EUIPO first (~€850, one class + fees; first-to-file jurisdiction — this is the one that matters), USPTO within the 6-month priority window only if US commercial traction exists. Rationale on record: the mark is consumer protection (stopping malicious forks from shipping as "Molt") and the legal substrate for future certification (BL-08), not a fence around users — Apache 2.0 already grants them everything.

- **AC:** Search results + draft application in `molt-cloud/legal/` during Phase 0; the four triggers listed in the team's launch checklist; a star-count watch exists (GitHub notification or a 5-line cron) so trigger (b) can't pass silently; if any trigger fires, filing submitted within 7 days.
- **Est:** 0.5 h now + 2 h if triggered (+ fees) · **Deps:** none

---

## Post-launch backlog (not v1 — tracked so nothing is forgotten)

- **BL-01** Benchmark suite: 50 scripted checkout tasks, success rate per rung/platform, published table. (Second launch post.)
- **BL-02** Stablecoin-backed cards, full rollout beyond the OT-114 stretch: mainnet, multi-issuer (Stripe/Bridge, Rain), EU availability review, fresh G4 assessment.
- **BL-03** x402 mainnet: graduate Epic 11 from testnet to mainnet USDC once the hosted live-mode legal work (BL-09) exists.
- **BL-04** ACP/UCP L0 probing beyond stubs.
- **BL-05** Push-notification step-up (replace email).
- **BL-06** WooCommerce + Magento adapters.
- **BL-07** AP2-compatible mandate profile, published.
- **BL-08** Agent registry + Stamp verification endpoint for CDNs/merchants.
- **BL-09** Hosted live mode: legal memo (TSP classification), issuer contract, pricing page.
- **BL-10** Accounting export (CSV/DATEV).

---

## Sequencing

**Critical path (strict dependency order):** OT-020 → OT-021 → OT-022 → OT-031 → OT-052 → OT-054 → OT-040 → OT-095 → OT-096 → OT-097.

**Build phases (execute in order; phases are gates, tickets inside a phase parallelize freely):**

- **Phase 0 — Foundation:** Epic 0 complete, OT-004 Stripe applications submitted, OT-092 storyboard written (it films last but directs reliability priorities from day one), OT-010 spec drafting started.
- **Phase 1 — Trust core:** Epic 2 (WebAuthn, ceremony, mandate engine, policy, tap, API) + Epic 1 spec finalized against the implementation. Gate: OT-022 adversarial test suite fully green.
- **Phase 2 — Money + execution:** Epic 3 (cards, webhooks) and Epic 5 (detector, Shopify adapter, preflight, Stamp, L2 fallback). Gate: OT-052 at ≥90% over 20 consecutive runs.
- **Phase 3 — Agent surface + proof:** Epic 4 (MCP) + Epic 6 (receipts) + Epic 11 (x402 rung; OT-114 only if Stripe approval has landed).
- **Phase 4 — Product shell:** Epic 7 (dashboard) + Epic 8 (test-mode gate, disclaimers, GDPR).
- **Phase 5 — Launch assets:** Epic 9 (docs, landing, README, HN post) + Epic 12 (pricing, waitlist v2, sponsors, partner intake, commercial guardrails) + demo production (OT-095 → 096 → 097).
- **Phase 6 — Hardening + launch:** Epic 10 (dry runs, security pass, load sanity) → launch on a weekday morning US time.

**Parallel workstreams for a team (suggested split):**

- **A · Protocol & trust:** Epics 1, 2, 6 + OT-060 CLI — owns the spec staying in lockstep with `packages/protocol`.
- **B · Payments & rails:** Epic 3 + Epic 11 — owns Stripe and x402 integration, watches the guardrails hardest.
- **C · Execution:** Epic 5 — owns adapter reliability; their success metric is the OT-052 number.
- **D · Product & launch:** Epics 7, 8, 9, 12 + demo tickets — owns everything a stranger sees, including the commercial surfaces.

Workstreams B, C, D can start scaffolding immediately after Phase 0, but nothing merges against mandates until A delivers OT-022. Per-ticket hour estimates remain in the tickets for planning; total scope is ~220 h of implementation work.

**Two rules for the whole build:** never trade away a G-guardrail for a feature, and never cut OT-022's test suite for time — it is the claim the entire launch stands on.
