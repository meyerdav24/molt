/**
 * The purchase flow (OT-040): one call, one shell.
 *
 *   resolve merchant -> quote (no card!) -> cart hash -> duplicate check
 *   -> mint child mandate scoped to exactly this cart -> get scoped card
 *   -> checkout with exact-total preflight -> dual-signed receipt.
 *
 * Fail-closed at every joint: a quote above max_amount never mints, a held
 * mandate never touches a card, any checkout failure sheds the shell
 * (mandate canceled, card dies, budget refunded). The narrowing rule does
 * the heavy lifting - this code only ever ASKS, the TA decides.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  ALLOWED_NETWORK,
  cartHash,
  deriveIdempotencyKey,
  fetchWithX402,
  loadWallet,
  parseEnvelope,
  preflightValidate,
  resolveMerchant,
  shopifyCheckout,
  shopifyQuote,
  type DetectionResult,
  type NormalizedCart,
} from '@molt/adapters';
import {
  sha256CanonicalHex,
  signReceiptAsAgent,
  type MandateBounds,
  type ReceiptBody,
  type SignedReceipt,
} from '@molt/protocol';
import type { MoltConfig } from './config.js';
import type { AgentSigningKey } from './signing.js';
import { TaClient } from './ta.js';

export interface PurchaseInput {
  tab_id: string;
  merchant_url: string;
  /** Cart lines for store checkouts; irrelevant for x402 paid endpoints. */
  items?: { variant_id: number; quantity: number }[] | undefined;
  max_amount_minor: number;
  reason: string;
  /** Resume a held purchase after the user approved it via the Tap. */
  mandate_id?: string | undefined;
}

export type PurchaseOutcome =
  | {
      status: 'purchased';
      receipt: SignedReceipt;
      order_confirmation: string;
      message: string;
    }
  | {
      status: 'step_up_pending';
      mandate_id: string;
      message: string;
      triggers?: unknown;
    }
  | { status: 'already_purchased'; idempotency_key: string; receipt_id: string; message: string }
  | { status: 'handoff_l3'; deep_link: string; detection: DetectionResult; message: string }
  | { status: 'refused'; reason: string; detail?: unknown; message: string }
  | {
      status: 'failed';
      stage: string;
      reason: string;
      detail: string;
      shell_shed: boolean;
      message: string;
    }
  | {
      status: 'purchased_receipt_unfiled';
      order_confirmation: string;
      detail: string;
      message: string;
    };

interface MintResponse {
  status?: string;
  mandate_id?: string;
  parent_id?: string;
  bounds?: MandateBounds;
  card?: CardDetails | null;
  triggers?: unknown;
  error?: string;
  violations?: unknown;
  message?: string;
}

interface CardDetails {
  card_id: string;
  number: string;
  cvc: string;
  exp_month: number;
  exp_year: number;
  brand: string;
}

interface MandatePoll {
  id?: string;
  parent_id?: string;
  status?: string;
  bounds?: MandateBounds;
  cart_hash?: string;
  card?: CardDetails | null;
  error?: string;
}

function refuse(reason: string, message: string, detail?: unknown): PurchaseOutcome {
  return { status: 'refused', reason, message, ...(detail !== undefined ? { detail } : {}) };
}

/**
 * A dead tab teaches at the point of failure (works for every MCP client,
 * with or without a custom system prompt): the agent learns what happened
 * and that this molt entry is now dead weight it may clean up itself.
 */
function tabDead(status: string | undefined): PurchaseOutcome {
  const st = status ?? 'inactive';
  return refuse(
    'tab_not_active',
    `this tab is ${st}: no purchases can ever run on it again and this agent key answers nothing useful anymore. ` +
      `Tell the user. If you manage your own MCP configuration, offer to remove this molt server entry; ` +
      `a new tab (open_tab) comes with a new key.`,
  );
}

/** Cancel the mandate so the card dies and the budget flows back. */
async function shedShell(ta: TaClient, mandateId: string): Promise<boolean> {
  try {
    const res = await ta.call('DELETE', `/v1/mandates/${mandateId}`);
    return res.status === 200;
  } catch {
    return false; // TTL + webhook guard still bound the exposure to this one shell
  }
}

/** Live narration for the agent host (OT-100 finding: minutes of silence
 *  during a purchase are unacceptable; every step reports). */
export type ProgressFn = (message: string) => void;

export async function purchase(
  cfg: MoltConfig,
  ta: TaClient,
  signingKey: AgentSigningKey,
  input: PurchaseInput,
  onProgress?: ProgressFn,
): Promise<PurchaseOutcome> {
  // --- rung selection -------------------------------------------------------
  onProgress?.('resolving merchant platform');
  const detection = await resolveMerchant(input.merchant_url);
  if (detection.platform === 'x402') {
    onProgress?.('merchant speaks x402: paying on the L0 rung');
    return purchaseL0(cfg, ta, signingKey, input, detection, onProgress);
  }
  if (detection.platform !== 'shopify') {
    return {
      status: 'handoff_l3',
      deep_link: input.merchant_url,
      detection,
      message: `L3 handoff: no supported checkout protocol detected. Give the human this link to buy it themselves: ${input.merchant_url}`,
    };
  }
  if (!input.items || input.items.length === 0) {
    return refuse('items_required', 'this merchant is a store; pass items (variant_id, quantity)');
  }
  const items = input.items;
  if (!cfg.shipping) {
    return refuse(
      'shipping_profile_missing',
      'MOLT_SHIPPING_PROFILE is not configured; the checkout needs a delivery address',
    );
  }

  const origin = new URL(input.merchant_url).origin;
  const host = new URL(origin).hostname.toLowerCase();
  const sessionStatePath = join(cfg.evidenceDir, `session-${host}.json`);
  const quoteReq = {
    store_url: origin,
    ...(cfg.storefrontPasswords.has(host)
      ? { storefront_password: cfg.storefrontPasswords.get(host) as string }
      : {}),
    items,
    shipping: cfg.shipping,
    session_state_path: sessionStatePath,
    headed: cfg.headed,
    timeout_ms: cfg.checkoutTimeoutMs,
  };

  // --- quote: walk to checkout with NO card, extract the real cart ----------
  onProgress?.(
    'quote pass: walking the store checkout with NO card (can take 30-120s; slow stores are waited out politely)',
  );
  const quote = await shopifyQuote(quoteReq);
  if (!quote.ok) {
    return {
      status: 'failed',
      stage: quote.stage,
      reason: quote.reason,
      detail: quote.detail,
      shell_shed: false, // nothing was minted yet
      message: `quote failed before any mandate or card existed: ${quote.reason} (${quote.detail})`,
    };
  }
  const cart: NormalizedCart = quote.cart;
  const hash = cartHash(cart);
  const idempotencyKey = deriveIdempotencyKey(input.tab_id, origin, hash);
  onProgress?.(
    `quoted ${cart.total_minor} ${cart.currency} minor units for this exact cart; checking for duplicates`,
  );

  // --- OT-054: the same cart commits at most once ---------------------------
  const receipts = await ta.call<{ receipts?: { id: string; idempotency_key: string }[] }>(
    'GET',
    `/v1/tabs/${input.tab_id}/receipts`,
  );
  const dup = receipts.body.receipts?.find((r) => r.idempotency_key === idempotencyKey);
  if (dup) {
    return {
      status: 'already_purchased',
      idempotency_key: idempotencyKey,
      receipt_id: dup.id,
      message: `this exact cart at ${origin} was already purchased on this tab (receipt ${dup.id}); refusing to double-order`,
    };
  }

  if (cart.total_minor > input.max_amount_minor) {
    return refuse(
      'quote_exceeds_max_amount',
      `checkout total is ${cart.total_minor} ${cart.currency} minor units but max_amount_minor is ${input.max_amount_minor}; nothing was minted`,
      { quote: cart },
    );
  }

  // --- child mandate: fresh mint, or resume one held for the Tap ------------
  let mandateId: string;
  let parentId: string | undefined;
  let bounds: MandateBounds | undefined;
  let card: CardDetails | null | undefined;

  if (input.mandate_id) {
    const poll = await ta.call<MandatePoll>('GET', `/v1/mandates/${input.mandate_id}`);
    if (poll.status !== 200) {
      return refuse('mandate_not_found', `mandate ${input.mandate_id} not found on this tab`);
    }
    const m = poll.body;
    if (m.status === 'held') {
      return {
        status: 'step_up_pending',
        mandate_id: input.mandate_id,
        message:
          'still waiting for the user: approval was requested via email (the Tap). Try again after they approve, or tell them to check their inbox.',
      };
    }
    if (m.status !== 'active' && m.status !== 'approved') {
      return refuse(
        `mandate_${m.status ?? 'unusable'}`,
        `mandate ${input.mandate_id} is ${m.status}; start a fresh purchase`,
      );
    }
    if (m.cart_hash !== hash) {
      // The store's cart no longer matches what the user approved: shed and
      // re-run so the mandate always covers exactly what gets bought.
      const shed = await shedShell(ta, input.mandate_id);
      return refuse(
        'cart_changed_since_approval',
        `the checkout cart changed since mandate ${input.mandate_id} was approved; the mandate was ${shed ? 'canceled' : 'left to expire'}. Re-run purchase without mandate_id.`,
      );
    }
    mandateId = input.mandate_id;
    parentId = m.parent_id;
    bounds = m.bounds;
    card = m.card;
  } else {
    onProgress?.('requesting a child mandate scoped to exactly this cart');
    const mint = await ta.call<MintResponse>('POST', `/v1/tabs/${input.tab_id}/mandates`, {
      merchant_origin: origin,
      amount_minor: cart.total_minor,
      cart_hash: hash,
      reason: input.reason,
      // shown to the human on the step-up page if this gets held
      items_summary: cart.lines.map((l) => `${l.quantity}× ${l.title}`),
    });
    if (mint.status === 202 && mint.body.mandate_id) {
      return {
        status: 'step_up_pending',
        mandate_id: mint.body.mandate_id,
        triggers: mint.body.triggers,
        message:
          `user approval requested via email (the Tap). The purchase is on hold, nothing was charged. ` +
          `Once the user approves, call purchase again with the same arguments plus mandate_id="${mint.body.mandate_id}".`,
      };
    }
    if (mint.status !== 201 || !mint.body.mandate_id) {
      if (mint.body.error === 'tab_not_active') {
        return tabDead((mint.body as { status?: string }).status);
      }
      return refuse(
        mint.body.error ?? `mint_failed_${mint.status}`,
        `the Tab Authority refused the child mandate (${mint.status})`,
        mint.body.violations ?? mint.body,
      );
    }
    mandateId = mint.body.mandate_id;
    parentId = mint.body.parent_id;
    bounds = mint.body.bounds;
    card = mint.body.card;
  }

  if (!bounds || !parentId) {
    return refuse('mandate_incomplete', 'the TA response was missing bounds or parent_id');
  }
  if (!card) {
    const shed = await shedShell(ta, mandateId);
    return refuse(
      'card_unavailable',
      `no card details were available for mandate ${mandateId} (one-time delivery already consumed or provisioning failed); ` +
        `the mandate was ${shed ? 'canceled' : 'left to expire'}. Re-run purchase without mandate_id.`,
    );
  }

  // --- OT-054 commit gate: mandate must cover exactly this cart -------------
  const violations = preflightValidate(cart, { bounds, cart_hash: hash });
  if (violations.length > 0) {
    const shed = await shedShell(ta, mandateId);
    return refuse(
      'preflight_violation',
      `commit gate refused before card entry; shell ${shed ? 'shed' : 'expiring'}`,
      violations,
    );
  }

  onProgress?.(
    'shell grown: single-use card delivered; commit pass through the checkout (30-120s)',
  );
  // --- checkout: card enters only if the displayed total matches exactly ----
  // Bogus-gateway dev stores cannot charge a test-mode Issuing card (Stripe
  // test mode never routes across accounts), so there the simulated acquirer
  // gets its success card while the shell stays real and is shed either way.
  const cardName = `${cfg.shipping.first_name} ${cfg.shipping.last_name}`;
  const cardPayload = cfg.bogusGatewayHosts.has(host)
    ? { number: '1', exp_month: 12, exp_year: 2030, cvc: '123', name: cardName }
    : {
        number: card.number,
        exp_month: card.exp_month,
        exp_year: card.exp_year,
        cvc: card.cvc,
        name: cardName,
      };
  const result = await shopifyCheckout({
    ...quoteReq,
    card: cardPayload,
    expected_total_minor: cart.total_minor,
    evidence_dir: cfg.evidenceDir,
  });

  if (!result.ok) {
    const shed = await shedShell(ta, mandateId);
    return {
      status: 'failed',
      stage: result.stage,
      reason: result.reason,
      detail: result.detail,
      shell_shed: shed,
      message:
        `checkout failed at ${result.stage} (${result.reason}); the shell was ${shed ? 'shed: card dead, budget refunded' : 'not confirmed shed, but it expires on its own TTL'}. ` +
        `Nothing further will be charged.`,
    };
  }

  // --- receipt: agent signs, TA countersigns, verifiable offline ------------
  onProgress?.(
    `order confirmed (${result.order_confirmation.slice(0, 40)}); filing the dual-signed receipt`,
  );
  const body: ReceiptBody = {
    id: randomUUID(),
    tab_id: input.tab_id,
    mandate_id: mandateId,
    rung: 'L1',
    rail: 'card_stripe_test',
    merchant: origin,
    amount_minor: result.total_minor,
    currency: cart.currency,
    evidence: {
      dom_sha256: result.evidence.dom_sha256,
      screenshot_sha256: result.evidence.screenshot_sha256,
    },
    idempotency_key: idempotencyKey,
    mandate_chain: [parentId, mandateId],
    created_at: new Date().toISOString(),
  };
  const filed = await ta
    .call<{ receipt?: SignedReceipt }>('POST', `/v1/mandates/${mandateId}/receipt`, {
      receipt: body,
      agent_signature: signReceiptAsAgent(body, signingKey.privatePem),
      agent_public_key: signingKey.publicPem,
    })
    .catch(() => null);

  if (!filed || filed.status !== 201 || !filed.body.receipt) {
    // The order EXISTS; say so plainly instead of pretending it failed.
    return {
      status: 'purchased_receipt_unfiled',
      order_confirmation: result.order_confirmation,
      detail: filed ? JSON.stringify(filed.body) : 'ta_unreachable',
      message:
        `the order went through (${result.order_confirmation}) but filing the receipt failed; ` +
        `the mandate stays consumed-in-fact and the settlement webhook will still record the transaction. Report this to the user.`,
    };
  }

  return {
    status: 'purchased',
    receipt: filed.body.receipt,
    order_confirmation: result.order_confirmation,
    message: `purchased at ${origin} for ${result.total_minor} ${cart.currency} minor units, rung L1. Receipt ${filed.body.receipt.id} is dual-signed and verifiable via 'molt verify'.`,
  };
}

/**
 * The L0 rung (OT-111): pay an x402 endpoint with testnet USDC from the
 * operator's local wallet. Mandate bounds are enforced CLIENT-SIDE before
 * any signature exists: the endpoint origin must equal the mandate's
 * merchant scope, and the signing cap is exactly the quoted atomic amount
 * the mandate was minted for.
 *
 * Amount mapping, stated plainly: testnet USDC is treated 1:1 with the
 * tab currency, atomic units (6 dp) ceil-converted to minor units (2 dp).
 * Play money; the mapping exists so the narrowing engine and budget math
 * stay authoritative. Each call to a paid API is a distinct consumption,
 * so the L0 cart hash includes a nonce - the double-spend bound is the
 * one-shot child mandate itself, not cart identity.
 */
async function purchaseL0(
  cfg: MoltConfig,
  ta: TaClient,
  signingKey: AgentSigningKey,
  input: PurchaseInput,
  detection: DetectionResult,
  onProgress?: ProgressFn,
): Promise<PurchaseOutcome> {
  const origin = new URL(input.merchant_url).origin;

  if (!cfg.walletPassphrase) {
    return refuse(
      'wallet_unavailable',
      'the x402 rung needs the local wallet: set MOLT_WALLET_PASSPHRASE (and MOLT_WALLET_PATH if not ~/.molt/wallet.json)',
    );
  }
  let account;
  try {
    account = loadWallet(cfg.walletPath, cfg.walletPassphrase);
  } catch (e) {
    return refuse('wallet_unavailable', e instanceof Error ? e.message : 'wallet load failed');
  }

  // --- probe: read the terms, no payment involved ---------------------------
  onProgress?.('reading the 402 payment terms (no payment yet)');
  let probeBody = '';
  let probeStatus = 0;
  try {
    const probe = await fetch(input.merchant_url, {
      signal: AbortSignal.timeout(15_000),
    });
    probeStatus = probe.status;
    probeBody = await probe.text();
  } catch {
    return {
      status: 'failed',
      stage: 'l0_probe',
      reason: 'endpoint_unreachable',
      detail: `no response from ${input.merchant_url}`,
      shell_shed: false,
      message: 'the x402 endpoint did not answer; nothing was minted or signed',
    };
  }
  if (probeStatus !== 402) {
    return refuse(
      'no_payment_required',
      `endpoint answered ${probeStatus}, not 402; nothing to pay`,
    );
  }
  const envelope = parseEnvelope(probeBody);
  const terms = envelope?.accepts.find(
    (a) => a.scheme === 'exact' && a.network === ALLOWED_NETWORK,
  );
  if (!terms) {
    return refuse(
      'no_acceptable_terms',
      `endpoint offers no "exact" terms on ${ALLOWED_NETWORK}; test mode pays nothing else`,
    );
  }

  const atomic = BigInt(terms.maxAmountRequired);
  const cents = Number((atomic + 9_999n) / 10_000n);
  if (cents > input.max_amount_minor) {
    return refuse(
      'quote_exceeds_max_amount',
      `endpoint asks ${terms.maxAmountRequired} atomic units (~${cents} minor) but max_amount_minor is ${input.max_amount_minor}; nothing was minted`,
    );
  }

  // --- child mandate --------------------------------------------------------
  let mandateId: string;
  let parentId: string | undefined;
  let bounds: MandateBounds | undefined;

  if (input.mandate_id) {
    const poll = await ta.call<MandatePoll>('GET', `/v1/mandates/${input.mandate_id}`);
    if (poll.status !== 200) {
      return refuse('mandate_not_found', `mandate ${input.mandate_id} not found on this tab`);
    }
    if (poll.body.status === 'held') {
      return {
        status: 'step_up_pending',
        mandate_id: input.mandate_id,
        message:
          'still waiting for the user: approval was requested via email (the Tap). Try again after they approve.',
      };
    }
    if (poll.body.status !== 'active' && poll.body.status !== 'approved') {
      return refuse(
        `mandate_${poll.body.status ?? 'unusable'}`,
        `mandate ${input.mandate_id} is ${poll.body.status}; start a fresh purchase`,
      );
    }
    mandateId = input.mandate_id;
    parentId = poll.body.parent_id;
    bounds = poll.body.bounds;
  } else {
    const hash = sha256CanonicalHex({
      resource: terms.resource ?? input.merchant_url,
      amount_atomic: atomic.toString(),
      nonce: randomUUID(),
    });
    const mint = await ta.call<MintResponse>('POST', `/v1/tabs/${input.tab_id}/mandates`, {
      merchant_origin: origin,
      amount_minor: cents,
      cart_hash: hash,
      reason: input.reason,
      items_summary: [terms.description ?? `x402 paid request to ${origin}`],
    });
    if (mint.status === 202 && mint.body.mandate_id) {
      return {
        status: 'step_up_pending',
        mandate_id: mint.body.mandate_id,
        triggers: mint.body.triggers,
        message:
          `user approval requested via email (the Tap). Nothing was signed or paid. ` +
          `Once approved, call purchase again with the same arguments plus mandate_id="${mint.body.mandate_id}".`,
      };
    }
    if (mint.status !== 201 || !mint.body.mandate_id) {
      if (mint.body.error === 'tab_not_active') {
        return tabDead((mint.body as { status?: string }).status);
      }
      return refuse(
        mint.body.error ?? `mint_failed_${mint.status}`,
        `the Tab Authority refused the child mandate (${mint.status})`,
        mint.body.violations ?? mint.body,
      );
    }
    mandateId = mint.body.mandate_id;
    parentId = mint.body.parent_id;
    bounds = mint.body.bounds;
  }

  if (!bounds || !parentId) {
    return refuse('mandate_incomplete', 'the TA response was missing bounds or parent_id');
  }

  // --- client-side enforcement BEFORE any signature (OT-111 AC) -------------
  if (bounds.merchant_scope !== origin) {
    const shed = await shedShell(ta, mandateId);
    return refuse(
      'merchant_outside_mandate_scope',
      `endpoint origin ${origin} != mandate scope ${bounds.merchant_scope}; shell ${shed ? 'shed' : 'expiring'}`,
    );
  }
  const capAtomic = BigInt(bounds.amount_minor) * 10_000n;
  if (atomic > capAtomic) {
    const shed = await shedShell(ta, mandateId);
    return refuse(
      'amount_exceeds_mandate',
      `endpoint asks ${atomic} atomic units, mandate covers ${capAtomic}; refused before signing; shell ${shed ? 'shed' : 'expiring'}`,
    );
  }

  // --- pay ------------------------------------------------------------------
  onProgress?.(
    'mandate active: signing the transfer authorization from the local wallet and paying',
  );
  const result = await fetchWithX402(input.merchant_url, {
    account,
    maxAmountMinor: atomic,
  });

  if (!result.ok) {
    const shed = await shedShell(ta, mandateId);
    const fallbackHint = detection.signals.some((s) => s.startsWith('shopify'))
      ? ' The merchant also looks like a store; re-running purchase with items falls back to L1.'
      : '';
    return {
      status: 'failed',
      stage: 'l0_payment',
      reason: result.reason,
      detail: result.detail,
      shell_shed: shed,
      message: `x402 payment failed (${result.reason}); the shell was ${shed ? 'shed, budget refunded' : 'left to its TTL'}. Nothing was charged.${fallbackHint}`,
    };
  }
  if (!result.paid) {
    const shed = await shedShell(ta, mandateId);
    return refuse(
      'no_payment_required',
      `endpoint stopped asking for payment (answered ${result.status}); shell ${shed ? 'shed' : 'expiring'}, nothing paid`,
    );
  }

  // --- receipt --------------------------------------------------------------
  const idempotencyKey = deriveIdempotencyKey(
    input.tab_id,
    origin,
    sha256CanonicalHex({ tx: result.settlement?.transaction ?? randomUUID() }),
  );
  const body: ReceiptBody = {
    id: randomUUID(),
    tab_id: input.tab_id,
    mandate_id: mandateId,
    rung: 'L0',
    rail: 'usdc_x402_testnet',
    merchant: origin,
    amount_minor: cents,
    currency: bounds.currency,
    evidence: {
      ...(result.settlement?.transaction ? { onchain_tx_hash: result.settlement.transaction } : {}),
    },
    idempotency_key: idempotencyKey,
    mandate_chain: [parentId, mandateId],
    created_at: new Date().toISOString(),
  };
  const filed = await ta
    .call<{ receipt?: SignedReceipt }>('POST', `/v1/mandates/${mandateId}/receipt`, {
      receipt: body,
      agent_signature: signReceiptAsAgent(body, signingKey.privatePem),
      agent_public_key: signingKey.publicPem,
    })
    .catch(() => null);

  if (!filed || filed.status !== 201 || !filed.body.receipt) {
    return {
      status: 'purchased_receipt_unfiled',
      order_confirmation: result.settlement?.transaction ?? 'paid (no settlement hash)',
      detail: filed ? JSON.stringify(filed.body) : 'ta_unreachable',
      message:
        'the x402 payment settled but filing the receipt failed; the on-chain transaction stands. Report this to the user.',
    };
  }

  return {
    status: 'purchased',
    receipt: filed.body.receipt,
    order_confirmation: result.settlement?.transaction ?? 'settled',
    message: `paid ${(Number(atomic) / 1e6).toFixed(2)} testnet USDC at ${origin}, rung L0, settled on ${ALLOWED_NETWORK}. Receipt ${filed.body.receipt.id} is dual-signed and verifiable offline.`,
  };
}
