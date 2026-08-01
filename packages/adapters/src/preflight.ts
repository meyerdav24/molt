/**
 * Preflight + commit protocol (OT-054), deterministic core.
 *
 * Before any card entry, on every rung: the final cart (line items, total,
 * currency) is normalized and hashed; the hash is what the child mandate is
 * scoped to, and the idempotency key derives from (tab, merchant, cart hash)
 * so the same cart can never commit twice. Any mismatch between checkout
 * reality and mandate refuses the commit.
 *
 * The optional task-compliance check ("does this cart plausibly serve the
 * task declaration?") is pluggable; the LLM-backed implementation lives with
 * the agent surface (Epic 4), not here.
 */
import { createHash } from 'node:crypto';
import { sha256CanonicalHex, type MandateBounds } from '@molt/protocol';

export interface CartLine {
  variant_id: number;
  title: string;
  quantity: number;
  /** Unit price in minor units. */
  price_minor: number;
}

export interface NormalizedCart {
  merchant_origin: string;
  currency: string;
  lines: CartLine[];
  /** Products subtotal in minor units. */
  subtotal_minor: number;
  shipping_minor: number;
  /** Final total the checkout displays, in minor units. */
  total_minor: number;
}

/** Deterministic normalization: lines sorted by variant id, integers only. */
export function normalizeCart(cart: NormalizedCart): NormalizedCart {
  const lines = [...cart.lines]
    .map((l) => ({
      variant_id: l.variant_id,
      title: l.title.trim(),
      quantity: l.quantity,
      price_minor: l.price_minor,
    }))
    .sort((a, b) => a.variant_id - b.variant_id);
  return {
    merchant_origin: new URL(cart.merchant_origin).origin,
    currency: cart.currency.toUpperCase(),
    lines,
    subtotal_minor: cart.subtotal_minor,
    shipping_minor: cart.shipping_minor,
    total_minor: cart.total_minor,
  };
}

/** Hex SHA-256 over the canonical normalized cart: the mandate's cart_hash. */
export function cartHash(cart: NormalizedCart): string {
  return sha256CanonicalHex(normalizeCart(cart));
}

/** Idempotency key: same tab + merchant + cart can commit exactly once. */
export function deriveIdempotencyKey(
  tabId: string,
  merchantOrigin: string,
  cartHashHex: string,
): string {
  return createHash('sha256')
    .update(`${tabId}|${new URL(merchantOrigin).origin}|${cartHashHex}`, 'utf8')
    .digest('hex');
}

export type PreflightViolation =
  | { code: 'total_exceeds_mandate'; detail: string }
  | { code: 'currency_mismatch'; detail: string }
  | { code: 'merchant_mismatch'; detail: string }
  | { code: 'cart_hash_mismatch'; detail: string }
  | { code: 'arithmetic_mismatch'; detail: string };

/**
 * The commit gate: refuse unless checkout reality matches the mandate.
 * Total may be BELOW the mandate amount (price dropped since minting) but
 * never above; currency and merchant must match exactly; the cart must be
 * the one the mandate was scoped to; the numbers must add up.
 */
export function preflightValidate(
  cart: NormalizedCart,
  mandate: { bounds: MandateBounds; cart_hash: string },
): PreflightViolation[] {
  const v: PreflightViolation[] = [];
  const n = normalizeCart(cart);

  if (n.total_minor > mandate.bounds.amount_minor) {
    v.push({
      code: 'total_exceeds_mandate',
      detail: `checkout total ${n.total_minor} > mandate amount ${mandate.bounds.amount_minor}`,
    });
  }
  if (n.currency !== mandate.bounds.currency) {
    v.push({
      code: 'currency_mismatch',
      detail: `checkout currency ${n.currency} != mandate ${mandate.bounds.currency}`,
    });
  }
  if (n.merchant_origin !== mandate.bounds.merchant_scope) {
    v.push({
      code: 'merchant_mismatch',
      detail: `checkout merchant ${n.merchant_origin} != mandate scope ${mandate.bounds.merchant_scope}`,
    });
  }
  if (cartHash(n) !== mandate.cart_hash) {
    v.push({
      code: 'cart_hash_mismatch',
      detail: 'checkout cart differs from the cart the mandate was minted for',
    });
  }
  const sum = n.lines.reduce((acc, l) => acc + l.price_minor * l.quantity, 0);
  if (sum !== n.subtotal_minor || n.subtotal_minor + n.shipping_minor !== n.total_minor) {
    v.push({
      code: 'arithmetic_mismatch',
      detail: `lines sum ${sum}, subtotal ${n.subtotal_minor}, shipping ${n.shipping_minor}, total ${n.total_minor} do not add up`,
    });
  }
  return v;
}
