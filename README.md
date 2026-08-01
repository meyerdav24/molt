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

## Connect an agent (MCP)

The MCP server exposes four tools: `open_tab`, `resolve_merchant`, `purchase`, `get_receipts`. Opening a tab always happens in the browser with your passkey; the agent only ever receives the ceremony URL.

Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "molt": {
      "command": "node",
      "args": ["/path/to/molt/apps/mcp-server/dist/index.js"],
      "env": {
        "MOLT_API_URL": "http://localhost:3000",
        "MOLT_AGENT_KEY": "molt_sk_test_...",
        "MOLT_SHIPPING_PROFILE": "{\"email\":\"you@example.com\",\"first_name\":\"Ada\",\"last_name\":\"Lovelace\",\"address1\":\"Teststr. 1\",\"city\":\"Munich\",\"zip\":\"80331\",\"country_code\":\"DE\"}"
      }
    }
  }
}
```

Setup order: run the web app, ask the agent to `open_tab`, complete the passkey ceremony it links you to, create an agent key in the dashboard for that tab, put the key into `MOLT_AGENT_KEY`, restart the agent host. The key is scoped to that one tab and its limits; a purchase can never exceed them.

Optional variables: `MOLT_STOREFRONT_PASSWORDS` (`host|password,...` for password-protected dev stores), `MOLT_BOGUS_GATEWAY_HOSTS` (dev stores running Shopify's Bogus Gateway, where the simulated acquirer gets its test card while the scoped card stays real), `MOLT_EVIDENCE_DIR`, `MOLT_AGENT_SIGNING_KEY_PATH`. For a remote transport run with `--sse [port]`.

## Disclaimers

- The hosted beta (when it exists) is test-mode only. No real money moves.
- Self-hosters operate their own issuer relationship and are responsible for their own compliance.
- Molt is technical infrastructure. It never holds funds, never initiates payments, and never performs strong customer authentication.
- Nothing in this repository is financial or legal advice.

## License

[Apache 2.0](LICENSE). The spec and reference implementation are Apache 2.0 permanently. See [CONTRIBUTING.md](CONTRIBUTING.md).
