# Molt

**An open protocol for delegating bounded, autonomous spending authority to an AI agent, at any online store, including the overwhelming majority that expose no agentic commerce protocol at all.**

The name is the security model. The agent never holds your real card. For every purchase it grows a fresh, disposable **shell**, a single-use scoped payment credential sized exactly to that cart, wears it once, and sheds it. The agent molts after every purchase. Worst case, an attacker gets one shell.

You delegate the way you would at a bar: show ID once, open a tab with a limit, and anything unusual gets checked with you.

> **Status: pre-release.** The spec is drafting in [SPEC.md](SPEC.md). Nothing here moves real money: the reference Tab Authority runs exclusively against Stripe test mode and testnet USDC (Base Sepolia). Read [what Molt deliberately does not do](SPEC.md#7-what-molt-deliberately-does-not-do) first; the [threat model](SPEC.md#6-threat-model) states exactly what is and is not guaranteed.

## The three-party model

```
User ──(one passkey ceremony)──> Tab Authority ──(scoped credentials)──> Agent ──> any merchant
                                      │
                                      └── receipts, audit log, step-up channel
```

The merchant is deliberately not a party. It installs nothing, agrees to nothing, and sees an ordinary card transaction.

## Repository layout

| Path                | What it is                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| `SPEC.md`           | The protocol specification (v0.1-draft)                                        |
| `packages/protocol` | JSON Schemas, mandate-tree engine, receipt signing, `molt verify` CLI          |
| `packages/adapters` | Platform detector, checkout adapters, request signing (the Stamp), x402 client |
| `apps/web`          | Reference Tab Authority: dashboard, step-up page, REST API, webhooks, docs     |
| `apps/mcp-server`   | MCP server exposing the four agent tools                                       |
| `apps/demo-seller`  | Demo x402 paid API                                                             |
| `demo/`             | Demo kit: vocabulary, storyboard, seed and reset scripts                       |
| `supabase/`         | Database migrations                                                            |

## Quickstart

```sh
cp .env.example .env   # fill in the variables; every one is explained inline
docker compose up
```

Full self-hosting docs are being written alongside the implementation.

## Disclaimers

- The hosted beta (when it exists) is test-mode only. No real money moves.
- Self-hosters operate their own issuer relationship and are responsible for their own compliance.
- Molt is technical infrastructure. It never holds funds, never initiates payments, and never performs strong customer authentication.
- Nothing in this repository is financial or legal advice.

## License

[Apache 2.0](LICENSE). The spec and reference implementation are Apache 2.0 permanently. See [CONTRIBUTING.md](CONTRIBUTING.md).
