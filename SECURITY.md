# Security

## Reporting a vulnerability

Email `security@moltprotocol.dev`. No bug bounty in the beta; reports get a
human answer, credit if you want it, and a fix before disclosure where the
finding warrants it. The threat model lives in [SPEC.md](SPEC.md) section 6;
if you break one of its claims, that is exactly the mail we want.

## Security pass (OT-101, 2026-08-02)

Each item verified on this date against `main`; the commands are listed so
anyone can re-run them.

- [x] **No secrets in repo or history.** Full-history pattern scan
      (`git log --all -p` against Stripe/Resend key shapes, PEM blocks,
      connection strings with passwords). Three hits, all accepted by
      design: the published RFC 9421 test vector key in
      `packages/adapters/test-vectors/stamp.json` (exists only for the
      vector, stated in the file) and the well-known docker compose local
      dev credentials (`postgres:postgres@db`). GitHub secret scanning and
      push protection are active on the repo.
- [x] **RLS verified.** `pnpm test:rls`: 14 assertions (owner-scoped reads,
      cross-user isolation, write bans, anon sees nothing) green against
      the live database.
- [x] **Webhook signature checks.** `scripts/test-api.mjs` asserts invalid
      signatures are rejected and retries are idempotent (36 assertions
      green).
- [x] **API-key scoping.** Keys are tab-scoped, stored as SHA-256 hashes
      only; covered by the integration suite (401 paths, cross-tab 404s)
      and the dashboard smoke test (cross-user isolation over HTTP).
- [x] **Card-detail handling.** Code audit: card numbers exist only in the
      one-time delivery path (`deliverCardDetailsOnce`) and in the agent's
      in-memory checkout call; never logged, never in tool responses.
      Database scan: zero Luhn-valid PAN-shaped values across all events
      payloads, receipts and card rows (only `ic_` Stripe identifiers).
      The MCP fuzz suite (156 assertions) includes a PAN-leak check on
      every response.
- [x] **Mandate-tree adversarial tests green.** `pnpm --filter
@molt/protocol test`: 57 tests including the OT-022 narrowing
      suite. Nothing merges against mandates when this suite is red.
- [x] **Dependency audit.** `pnpm audit --prod`. postcss advisories fixed
      via override to >=8.5.12. Remaining findings are Next.js 14
      advisories whose fixes ship only in Next 15 (DoS via image
      optimizer remotePatterns: not used; RSC deserialization DoS: no
      server actions; middleware cache poisoning: the only middleware is
      the OT-102 rate limiter, which never redirects or rewrites).
      Accepted for the test-mode beta behind Vercel's edge; the Next 15
      migration is scheduled post-launch.
- [x] **WebAuthn challenge uniqueness.** Login/registration challenges are
      generated per request by @simplewebauthn and carried in a signed,
      single-use, 5-minute challenge cookie (`consumeChallenge`
      invalidates on read). The ceremony challenge is deliberately the
      SHA-256 of the canonical mandate document, so the passkey signs
      exactly the displayed bounds; cross-flow replay is blocked by the
      single-use cookie.
- [x] **Pre-public gate.** The public repo carries `ROADMAP.md`
      (implementer context + tickets); internal planning stays in the
      private companion repo and `PLAN.md` remains gitignored. A
      trigram-level grep of the full public history against the private
      planning text found only shared protocol vocabulary, no planning
      content.
- [ ] **External hostile review.** A 2-hour review by an external
      technical reader is scheduled before launch (tracked in the
      private TODO list).
