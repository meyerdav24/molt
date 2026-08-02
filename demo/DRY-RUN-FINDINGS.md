# Dry-run findings (OT-100, 2026-08-02)

Nine cold runs of the full loop (`node scripts/dry-run.mjs`): reset, fresh
tab, agent purchase over MCP (quote, mandate, card, checkout, dual-signed
receipt), `molt verify` on the receipt file, dashboard render, held purchase
at an unknown merchant, deny via the step-up link, refund, receipts list.

**Result: 6 complete runs with zero manual intervention, including the final
three consecutively at film-day spacing, all with the identical shape**
`purchase=purchased verify=valid stepup=step_up_pending deny=refunded receipts=2`
(satisfies the OT-095 three-consecutive-runs criterion). Three runs failed on
dev-store throttling with the intended fail-safe behavior: structured 429,
polite backoff, nothing minted, nothing charged.

## Papercuts found, and what happened to them

1. **`demo:reset` violated the events append-only trigger** (it tried to
   DELETE event rows). Fixed: tab deletion anonymizes events via FK cascade,
   which is the designed mechanism; the delete is gone. The earlier reset
   verification had never exercised the path with matching rows - the dry
   run did.
2. **The storyboard catch was arithmetically broken**: a 189.00 item against
   a 150.00 per-purchase max is refused by the narrowing rule (422) before
   the step-up policy can hold it. Take checklist now says 200.00 per
   purchase, with the reasoning.
3. **A fresh tab knows no merchants**: with step-up on unknown merchants the
   very first purchase is held too. Film flow: warm the tab up off camera or
   keep the first tap in the cut. Documented in AGENT-PROMPT.md.
4. **Dev stores throttle hard after ~20 rapid checkouts** (429 windows of an
   hour or more). The adapter's Retry-After backoff rode out mid-strength
   throttling (147s runs completed); deep throttling fails structured. Take
   spacing documented.
5. **Dry-run script crashed instead of failing cleanly** when a purchase
   returned no receipt. Fixed: guarded, reports FAIL and keeps going.

## Timings (healthy store, per stage)

reset 0.5s · seed 0.6s · purchase 20-30s (2 browser passes + mint + receipt;
up to ~150s when riding out throttle) · verify <0.1s · dashboard 0.5s ·
held quote+hold 7-8s · deny+refund 0.5s.

## Still human (by design)

The passkey ceremony and the approve tap are WebAuthn moments no script can
perform: they are on TODO-HUMAN as the device-matrix and Tap tests, now
unblocked by the hosted deployment.
