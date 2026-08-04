# Demo agent prompt (OT-095)

The system prompt and the one instruction used in the demo video. The catalog
is given to the agent up front because v1 has no product-search tool; that is
honest for a scripted demo and stated here so nobody mistakes it for magic.

## System prompt (paste into the agent's custom instructions; the launch demo uses Hermes Agent)

```
You are an office assistant with access to Molt, which lets you buy things
under a spending tab the user has approved with their passkey. Rules:

- Before buying at a store, call resolve_merchant on its URL once.
- Buy one cart per store visit with purchase(). Set max_amount_minor to the
  exact price you expect in cents. Give a short honest reason per purchase.
- If purchase returns step_up_pending, tell the user approval was requested
  via email, wait for them to approve, then retry with the mandate_id.
- If a purchase is refused or fails, report the structured reason and stop.
  Never retry a refused request unchanged. Never work around a limit.
- After finishing, call get_receipts and summarize what was bought for how
  much, and how much budget remains.

Known stores and catalog (dev stores, test mode; prices in EUR):

brightside-office-supply.myshopify.com
  Paper Towels (12-pack)          variant 50283550998767   12.00
  Printer Paper A4 (500 sheets)   variant 50283551359215   22.00
  USB-C Hub 7-in-1                variant 50283551555823   34.00

harborview-electronics.myshopify.com
  HDMI Cable 2m                   variant 54518565372179    9.00
  Wireless Mouse                  variant 54518566584595   25.00
  Webcam HD 1080p                 variant 54518569795859   45.00
  Espresso Machine Pro            variant 54518571237651  189.00

The tab id is: <TAB_ID>
```

## The instruction (scene 0:35, typed on camera)

```
Restock the office: paper towels, printer paper, and a USB-C hub. Stay under budget.
```

## The catch (scene 1:10)

```
Also get us an espresso machine, the good one.
```

The Espresso Machine Pro (189.00 at a merchant outside the office-supply
baseline) trips the step-up policy: mandate HELD, no shell grown, phone
notification, passkey tap, purchase resumes.

## Take checklist

1. `pnpm demo:reset` (clears tabs, cancels leftover shells, keeps the passkey)
1. Dev stores throttle after many rapid checkouts. If a run fails with a
   structured 429 (`cart_failed`), wait five minutes; the adapter backs off
   politely and never hammers. Space takes a few minutes apart.
1. Open a fresh tab in the dashboard: 400.00 total, 200.00 per purchase,
   1 week, step-up on unknown merchants. Per purchase MUST be at least
   189.00: the narrowing rule refuses (422) anything above the per-purchase
   max before the step-up policy can hold it, so a 150.00 cap would turn
   the espresso catch scene into a refusal instead of a held tap.
1. The catch works because harborview is an unknown merchant (held for the
   tap), not because of the price. A freshly opened tab knows NO merchants:
   with step-up on unknown merchants, the very FIRST brightside purchase
   would also be held. For the film flow, warm the tab up before rolling:
   one small brightside purchase off camera (or keep that first tap in the
   cut as the honest onboarding moment).
1. Create the agent key on the tab detail page and hand it to the agent:
   paste it into the chat and say "connect to my tab with this key". The
   agent calls `connect_tab`, which stores it locally - no config editing,
   no restart. (A key already in `~/.hermes/config.yaml` also works; the
   button rotates, so creating a new one kills the old.)
1. `pnpm demo:check` must say "all green".
1. Roll.

## Scene 2 (the earn loop), if you film it

Two terminals, side by side with the dashboard:

```sh
# terminal 1: the paid API the agent earns from
DEMO_SELLER_PAY_TO_ADDRESS=$(grep '^MOLT_AGENT_WALLET_ADDRESS=' .env | cut -d= -f2) \
  node apps/demo-seller/dist/index.js

# terminal 2: three payments of 0.01 testnet USDC, visible 402 -> paid -> 200
node demo/buyer.mjs 3
```

The buyer wallet pays the agent wallet, both on Base Sepolia, real
settlement. Balances move within a minute; `pnpm wallet:balance` shows the
agent side.
