# Molt

**An open protocol for delegating bounded, autonomous spending authority to an AI agent, at any online store, including the overwhelming majority that expose no agentic commerce protocol at all.**

The name is the security model. The agent never holds your real card. For every purchase it grows a fresh, disposable **shell**, a single-use scoped payment credential sized exactly to that cart, wears it once, and sheds it. The agent molts after every purchase. Worst case, an attacker gets one shell.

You delegate the way you would at a bar: show ID once, open a tab with a limit, and anything unusual gets checked with you.

**The blast radius, up front:** prompt injection is assumed, not hoped away. Every purchase runs on a child mandate that can never exceed the tab you signed, is scoped to one store and one exact cart, and dies after one authorization. A fully compromised agent can spend at most one outstanding shell before anomaly triggers hold everything for your passkey. That claim, and its limits, are written down in the [threat model](SPEC.md#6-threat-model).

<!-- OT-097: the 90-second demo GIF embeds here once it exists. -->

> **Status: test-mode beta.** Live at [moltprotocol.dev](https://moltprotocol.dev), docs at [moltprotocol.dev/docs](https://moltprotocol.dev/docs). Nothing moves real money: the reference Tab Authority runs exclusively against Stripe test mode and testnet USDC (Base Sepolia), and refuses to boot otherwise.

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
| `demo/`             | Demo kit: vocabulary card, agent prompt, reset script, dry-run findings        |
| `supabase/`         | Database migrations                                                            |

## Quickstart

```sh
cp .env.example .env   # fill in the variables; every one is explained inline
docker compose up
```

Full docs (quickstart, MCP setup, API reference, rendered spec, FAQ) are served by the web app under `/docs`.

## Connect an agent (MCP)

The MCP server exposes four tools: `open_tab`, `resolve_merchant`, `purchase`, `get_receipts`. Opening a tab always happens in the browser with your passkey; the agent only ever receives the ceremony URL. Any MCP client works; two examples:

Hermes Agent (`~/.hermes/config.yaml`):

```yaml
mcp_servers:
  molt:
    command: 'node'
    args: ['/path/to/molt/apps/mcp-server/dist/index.js']
    env:
      MOLT_API_URL: 'https://moltprotocol.dev'
      MOLT_AGENT_KEY: 'molt_sk_test_...'
      MOLT_SHIPPING_PROFILE: '{"email":"you@example.com","first_name":"Ada","last_name":"Lovelace","address1":"Teststr. 1","city":"Munich","zip":"80331","country_code":"DE"}'
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "molt": {
      "command": "node",
      "args": ["/path/to/molt/apps/mcp-server/dist/index.js"],
      "env": {
        "MOLT_API_URL": "https://moltprotocol.dev",
        "MOLT_AGENT_KEY": "molt_sk_test_...",
        "MOLT_SHIPPING_PROFILE": "{\"email\":\"you@example.com\",\"first_name\":\"Ada\",\"last_name\":\"Lovelace\",\"address1\":\"Teststr. 1\",\"city\":\"Munich\",\"zip\":\"80331\",\"country_code\":\"DE\"}"
      }
    }
  }
}
```

Setup order: run the web app, ask the agent to `open_tab`, complete the passkey ceremony it links you to, create an agent key in the dashboard for that tab, put the key into `MOLT_AGENT_KEY`, restart the agent host. The key is scoped to that one tab and its limits; a purchase can never exceed them.

Optional variables: `MOLT_STOREFRONT_PASSWORDS` (`host|password,...` for password-protected dev stores), `MOLT_BOGUS_GATEWAY_HOSTS` (dev stores running Shopify's Bogus Gateway, where the simulated acquirer gets its test card while the scoped card stays real), `MOLT_EVIDENCE_DIR`, `MOLT_AGENT_SIGNING_KEY_PATH`. For a remote transport run with `--sse [port]`.

## What Molt deliberately does not do

Design commitments, not roadmap gaps ([full list with reasoning](SPEC.md#7-what-molt-deliberately-does-not-do)):

- No bot-detection evasion. Signed requests, honest user agent; blocked means blocked, reported as such.
- No funds custody and no payment initiation. The Tab Authority scopes; issuer rails execute.
- No strong customer authentication, and no claim to it.
- No crypto custody. Testnet only; keys stay with the agent operator.
- No post-purchase guarantees. Delivery and refunds stay between you and the store.
- No ToS dissolution. Your obligations to merchants are unchanged.

## Disclaimers

- The hosted beta at moltprotocol.dev is test-mode only. No real money moves.
- Self-hosters operate their own issuer relationship and are responsible for their own compliance.
- Molt is technical infrastructure. It never holds funds, never initiates payments, and never performs strong customer authentication.
- Nothing in this repository is financial or legal advice.

## License

[Apache 2.0](LICENSE). The spec and reference implementation are Apache 2.0 permanently, and the open project will not be relicensed. If Molt is useful to you, [sponsoring](https://github.com/sponsors/meyerdav24) buys maintenance time; it buys no features, because there are no features to withhold. Once independent implementations exist, spec governance is intended to move to a neutral home. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
