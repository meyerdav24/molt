# Molt demo storyboard (OT-092)

Total runtime: **≤ 2:00**. The molt storyline ([VOCAB.md](VOCAB.md)) is the narrative spine: shells grown, worn once, shed. Captions are burned in and carry the whole story for muted viewers. No background-music hype; optional calm voiceover. Speed-ramped sections show a visible elapsed-time counter — ramp, don't hide.

Filming gates: do not film until OT-052 is ≥ 90% over 20 consecutive runs and OT-100 dry runs are green. `pnpm demo:reset` (OT-095) restores everything in < 60 s between takes.

Recording setup (OT-096): 1080p+ screen capture, cursor smoothing on, browser zoom 125%, notifications off, single clean browser profile, phone scenes filmed physically on a tripod.

---

## Scene 1 · 0:00–0:05 · Cold open / claim

- **Screen layout:** full-frame text card, plain background. No logos, no music swell.
- **Exact caption (the whole scene):**
  > _"An AI agent is about to earn money, then spend it — at stores that have never heard of AI agents. It never touches a real card. It grows a disposable shell for every purchase, and sheds it."_
- **Data shown:** none.
- **Fallback:** none needed (static card). If Epic 11 slipped, change "earn money, then spend it" to "spend money" — the earn clause must not survive if Scene 2 is cut.

## Scene 2 · 0:05–0:20 · Earn loop — ONLY if Epic 11 landed

- **Screen layout:** split screen. Left: terminal running the buyer script against the OT-113 endpoint 3×, with the raw `402 → payment → 200` responses visible. Right: dashboard showing the agent wallet balance ticking up.
- **Exact caption:** _"testnet USDC — play money, real protocol."_
- **Data shown:** three x402 round-trips; balance increments; one outgoing x402 payment from the same wallet ends the segment.
- **Fallback:** **if Epic 11 slipped, cut this scene entirely; do not mention it anywhere.** If the facilitator is flaky on film day, pre-run the loop and capture a fresh take later; never splice fake terminal output.

## Scene 3 · 0:20–0:35 · The ceremony (the only human moment)

- **Screen layout:** dashboard on laptop, tab-creation form filling in real time. Cut to hands: fingerprint touch on camera (MacBook Touch ID, or phone in frame).
- **Data shown (exact values, seeded by OT-095):** €400 total · €150 per purchase · 1 week · categories "office & electronics" · step-up on unknown merchants.
- **Exact caption:** _"One approval. These exact limits are what the fingerprint signs."_
- **Fallback:** if Touch ID hardware shot fails, use the phone passkey prompt in frame instead. Never fake the biometric moment with a cut — one continuous take from form to fingerprint.

## Scene 4 · 0:35–0:40 · The instruction

- **Screen layout:** Claude Desktop, one message typed live:
  > _"Restock the office: paper towels, printer paper, and a USB-C hub. Stay under budget."_
- **Exact caption:** none (the typed message is the text).
- **Data shown:** the message only. Hands leave the keyboard and visibly stay out of frame for the rest of the video.
- **Fallback:** if Claude Desktop misbehaves, reset and retake; the hands-off beat is non-negotiable.

## Scene 5 · 0:40–1:10 · Three autonomous purchases (the molt cycle, three times)

- **Screen layout:** screen recording of the agent working: `resolve_merchant` → mandate approved (dashboard event log briefly visible) → checkout fills → order confirmation page. Purchase 1 near-full-speed; purchases 2–3 speed-ramped with a visible elapsed-time counter, no cuts.
- **The molt shot:** for one purchase, split-screen the Stripe test dashboard: the one-time card appears with its €-limit, gets used, then dies.
- **Exact caption sequence on the molt shot:** _"shell grown: €34, this store only"_ → _"worn once"_ → _"shed."_
- **Data shown:** paper towels €12, printer paper €22, USB-C hub €34 (seeded stores, OT-095); the dashboard shell counter ticks 1 → 2 → 3 across the three purchases.
- **Fallback:** if a checkout fails on camera, keep rolling — one graceful failure-recovery take (e.g. out-of-stock → agent substitutes) is candidate footage; imperfection reads as real. If the Stripe dashboard is slow to update, film the molt shot as its own take on the reset environment.

## Scene 6 · 1:10–1:30 · The catch (dramatic peak)

- **Screen layout:** agent attempts a 4th purchase at an unlisted merchant / above baseline. Dashboard shows the mandate **HELD** — visibly, no shell is grown. Physical phone enters the frame: notification visible → thumb tap → passkey prompt → approve. Shell appears; browser resumes and completes the order.
- **Exact caption:** _"No approval, no shell. Anything unusual needs a human thumb. Everything else didn't."_
- **Data shown:** the HELD state in the event log; the step-up email/notification; the passkey sheet; the resumed checkout.
- **Fallback:** the phone shot must be one continuous take (notification → thumb → passkey → resume). If email delivery lags on film day, pre-warm the provider and retake; never cut around the tap.

## Scene 7 · 1:30–1:50 · Proof

- **Screen layout:** dashboard receipt log: four receipts with rails/rungs visible, shed-shell count in the tab summary. Then terminal:
  1. `npx molt verify receipt.json` → ✅ `✓ receipt valid — shell was grown, worn once, and shed`
  2. Edit one byte of the JSON on screen, re-run → ❌ signature invalid.
- **Exact caption:** none beyond terminal output; it speaks for itself.
- **Data shown:** four receipts; the byte edit visible in the editor.
- **Fallback:** none acceptable. **This 10-second beat is non-negotiable** — it converts "demo" into "verifiable." If verify misbehaves, fix the CLI, reset, refilm.

## Scene 8 · 1:50–2:00 · Close

- **Screen layout:** full-frame text card, then GitHub URL.
- **Exact caption:**
  > _"4 purchases. 4 shells grown and shed. 0 real cards exposed. The stores did nothing. Open protocol, Apache 2.0 — docker compose up and run this yourself in 10 minutes."_
- **Data shown:** GitHub URL. End.
- **Fallback:** if Scene 2 was cut, the numbers stay correct as written (4 purchases refers to Scenes 5–6).

---

## Derivative cuts (OT-097)

- **(a)** full ≤ 2:00 video — YouTube unlisted + landing embed
- **(b)** 15–20 s GIF of the Scene 6 phone-tap beat — README
- **(c)** 30 s cut ending on the Scene 7 verify ✅/❌ beat — HN comment thread
- **(d)** 6–8 stills (ceremony, held mandate, dead card, verify) — docs and posts, including the "the molt" still of the card appearing and dying

## Review checklist (AC)

- [ ] Molt-storyline beats present in cold open, purchase scene, catch scene, close
- [ ] Reviewed by one technical friend before film day
- [ ] Reviewed by one non-technical friend before film day
- [ ] A muted viewer can follow the entire story from captions alone
