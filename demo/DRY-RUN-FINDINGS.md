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

## Rehearsal findings (2026-08-03, live against the hosted beta)

6. **Three MCC-to-Stripe category names were wrong**, so card provisioning
   failed for the office_electronics category - the exact path a real
   ceremony takes. Every integration test had seeded an empty allowlist,
   so it was never exercised. Fixed and validated against the live API;
   the e2e seed now carries the real MCCs.
7. **Gmail clipped the step-up email**: the trigger reason and deny
   guidance were byte-identical across mails and disappeared behind
   "trimmed content". Action button now leads, closing lines carry
   per-mail data, plain-text part added.
8. **A purchase was silent for minutes.** The MCP server now emits
   progress notifications for every stage (logging fallback).
9. **UX debt found and paid the same evening:**
   - _Agent key per tab meant editing a config file in a terminal._ The
     key panel now serves complete copy-paste MCP configs (Hermes YAML,
     Claude Desktop JSON) with the key and the TA's own URL filled in.
     The one-key-one-tab rule stays; it is the security model.
   - _Reserved budget was invisible._ The tab detail now splits spent
     from reserved (amber bar segment plus a plain-words explainer that
     a parked amount flows back if the purchase does not complete).

10. **Dev-store bot protection escalates per endpoint and does not forget.**
    After a day of automation (~30 checkouts plus rehearsals), brightside
    kept answering the storefront cart endpoints with challenges while its
    homepage looked perfectly healthy - so a homepage probe is not a
    readiness check. Everything else behaved correctly throughout: the
    commit pass failed structured, the shell was shed, the card died and
    the budget came back in full.

    **Mitigation for film day (do this, it is the single biggest risk to a
    shoot):** create the demo stores fresh shortly before filming (a new
    development store is about ten minutes) or leave at least a night of
    quiet between heavy rehearsal and the shoot, and keep a second store
    ready as the backup take target. Space takes minutes apart.

## Timings (healthy store, per stage)

reset 0.5s · seed 0.6s · purchase 20-30s (2 browser passes + mint + receipt;
up to ~150s when riding out throttle) · verify <0.1s · dashboard 0.5s ·
held quote+hold 7-8s · deny+refund 0.5s.

## Still human (by design)

The passkey ceremony and the approve tap are WebAuthn moments no script can
perform: they are on TODO-HUMAN as the device-matrix and Tap tests, now
unblocked by the hosted deployment.
