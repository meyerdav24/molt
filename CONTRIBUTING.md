# Contributing to Molt

Thanks for your interest. This file is a stub while v1 is under construction; it will grow.

## The contribution on-ramp: adapters

The highest-leverage contribution is a checkout adapter in `packages/adapters` — a new platform on the execution ladder (WooCommerce, Magento, a national shop system you know well). Adapter authors must follow the Stamp rules: honest user agent, RFC 9421 signed requests, zero stealth measures (no fingerprint spoofing, no CAPTCHA solving). Pull requests containing stealth tooling are closed without discussion.

## Vocabulary

User-facing copy follows the canonical vocabulary in [demo/VOCAB.md](demo/VOCAB.md). Shells in UI and marketing copy; formal terms (child mandate, card, payment payload) in spec and code identifiers.

## DCO sign-off (required)

All contributions require a [Developer Certificate of Origin](https://developercertificate.org/) sign-off. Add it with one git flag:

```sh
git commit --signoff
```

This appends a `Signed-off-by: Your Name <you@example.com>` line to your commit message, certifying you have the right to submit the work under Apache 2.0. CI rejects unsigned commits from non-team contributors. No CLA, no paperwork — one flag.

## Tests, and where they live

`pnpm -r test` runs the unit suites (protocol 57, adapters, mcp-server, demo-seller; all offline). The integration scripts need a running web app (`pnpm --filter @molt/web dev`) plus the variables in `.env.example`:

- `pnpm test:api` - every /v1 endpoint, policy and narrowing paths, dual-signed receipt round trip
- `pnpm test:dashboard` - dashboard, receipts download, GDPR deletion, tier cap, over real HTTP
- `node scripts/test-mcp-e2e.mjs` - a real L1 purchase driven through the MCP server (needs dev stores)
- `node scripts/test-x402-e2e.mjs [--real]` - the L0 rung; `--real` settles on Base Sepolia
- `node scripts/dry-run.mjs` - the full cold loop, one line of shape output per run
- `pnpm test:rls` - row-level-security assertions against the database

Nothing merges against `packages/protocol/src/mandate.ts` unless its adversarial suite is green.

## Ground rules

- Guardrails G1–G4 in the spec (no funds custody, no payment initiation, no SCA performance, no crypto custody) are product requirements. PRs that trade a guardrail for a feature are declined; the ticket changes, not the guardrail.
- The mandate narrowing engine's adversarial test suite must be green before anything touching mandates merges.
- Card details never appear in plaintext in the database or logs; store issuer card IDs only.
