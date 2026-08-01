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
  cartHash,
  deriveIdempotencyKey,
  preflightValidate,
  resolveMerchant,
  shopifyCheckout,
  shopifyQuote,
  type DetectionResult,
  type NormalizedCart,
} from '@molt/adapters';
import {
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
  items: { variant_id: number; quantity: number }[];
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

/** Cancel the mandate so the card dies and the budget flows back. */
async function shedShell(ta: TaClient, mandateId: string): Promise<boolean> {
  try {
    const res = await ta.call('DELETE', `/v1/mandates/${mandateId}`);
    return res.status === 200;
  } catch {
    return false; // TTL + webhook guard still bound the exposure to this one shell
  }
}

export async function purchase(
  cfg: MoltConfig,
  ta: TaClient,
  signingKey: AgentSigningKey,
  input: PurchaseInput,
): Promise<PurchaseOutcome> {
  // --- rung selection -------------------------------------------------------
  const detection = await resolveMerchant(input.merchant_url);
  if (detection.platform !== 'shopify') {
    const why =
      detection.platform === 'x402'
        ? 'merchant speaks x402, and the x402 rail is not wired into purchase yet (Epic 11)'
        : 'no supported checkout protocol detected';
    return {
      status: 'handoff_l3',
      deep_link: input.merchant_url,
      detection,
      message: `L3 handoff: ${why}. Give the human this link to buy it themselves: ${input.merchant_url}`,
    };
  }
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
    items: input.items,
    shipping: cfg.shipping,
    session_state_path: sessionStatePath,
    headed: cfg.headed,
  };

  // --- quote: walk to checkout with NO card, extract the real cart ----------
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
    const mint = await ta.call<MintResponse>('POST', `/v1/tabs/${input.tab_id}/mandates`, {
      merchant_origin: origin,
      amount_minor: cart.total_minor,
      cart_hash: hash,
      reason: input.reason,
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
