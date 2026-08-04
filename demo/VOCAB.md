# Molt vocabulary card

The canonical metaphor sentences. Quote these; do not improvise variants. Every user-facing surface (README, landing, docs, dashboard, video captions, launch posts) uses this card. Linked from CONTRIBUTING.md.

## The canonical sentences

- **"A shell is a disposable payment credential sized to one cart."**
- **"The agent molts after every purchase."**
- **"No approval, no shell."**
- **"Worst case, an attacker gets a shell at a store you already use."** (Never
  the shorter "an attacker gets one shell": nothing in the code limits an
  outstanding child to one, so that version overclaims. The bound is the
  per-purchase cap times the velocity limit, and an unknown merchant always
  waits for the tap.)
- The shell lifecycle, always in this order and wording: **"grown → worn once → shed."**

## The two metaphors and where each belongs

Both metaphors are load-bearing, and they never mix:

- **The tab** names the delegation: users **open a tab** (show ID once, set a limit, anything unusual gets checked with you). Tab language belongs to the ceremony, bounds, budget, and step-up.
- **Shells / molting** name the per-purchase credential: grown for one cart, worn once, shed. Shell language belongs to cards, payment payloads, and the purchase lifecycle.

Wrong: "the agent opens a shell", "a tab is shed", "your tab molts". If a sentence needs both ideas: _"open a tab once; the agent grows a fresh shell for every purchase under it."_

## Friendly ↔ formal term map

| Friendly (UI, marketing, captions) | Formal (spec, code identifiers, API)                            |
| ---------------------------------- | --------------------------------------------------------------- |
| shell                              | child mandate + its payment instrument (card / payment payload) |
| grow a shell                       | mint a child mandate and provision its scoped card              |
| worn once                          | single authorization consumed                                   |
| shed                               | card deactivated / mandate consumed                             |
| open a tab                         | create root mandate via passkey ceremony                        |
| the tab's limits                   | root mandate bounds                                             |
| check with you / tap to approve    | the Tap (step-up passkey assertion)                             |
| receipt                            | Receipt (dual-signed record)                                    |

**Rule:** shells in UI and marketing copy; formal terms in spec and code identifiers. Code never contains `shell` as an identifier; marketing never says "child mandate" without introducing it as the formal name for a shell.

## Product surfaces that carry the storyline (OT-098 deliverables 2–5)

- **Dashboard:** tab detail shows a **shell counter** (grown / worn / shed); receipt rows carry a small shed-shell indicator; the event log renders lifecycle entries as `shell grown → worn → shed`. One icon and three words — no animation festival.
- **Verify CLI:** success line is exactly `✓ receipt valid — shell was grown, worn once, and shed` (one line, no ASCII art).
- **README + landing:** the first diagram is the molt cycle (grow → wear → shed) around one purchase; the architecture diagram comes second.
- **Launch asset:** one still/GIF of the Stripe test dashboard card appearing and dying, captioned **"the molt"**.

## Style rules

- No em dashes in user-facing copy. No hype language.
- Never the name "OpenTab" anywhere.
- Plain claims only; the honesty section ("what Molt deliberately does not do") stays prominent.
