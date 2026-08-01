/**
 * L1 Shopify adapter (OT-052): deterministic storefront checkout.
 *
 * Strategy: the documented storefront AJAX API for cart building
 * (/cart/add.js - deterministic, no DOM guessing), Playwright for the
 * checkout form itself. Honest UA on every request. Development stores
 * keep a storefront password; entering it is authorized access to the
 * operator's own test store, not stealth.
 *
 * Fail-closed rules:
 * - The card is never touched before the displayed total matches the
 *   expected total exactly (basic preflight; OT-054 formalizes the
 *   full commit protocol).
 * - Any CAPTCHA or bot challenge -> structured blocked_by_merchant,
 *   never solved or bypassed (the Stamp, OT-055).
 * - Every failure is structured with the stage it happened in.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { NormalizedCart } from './preflight.js';
import { MOLT_USER_AGENT } from './stamp.js';

export interface ShippingProfile {
  email: string;
  first_name: string;
  last_name: string;
  address1: string;
  city: string;
  zip: string;
  /** ISO 3166-1 alpha-2, e.g. DE */
  country_code: string;
  phone?: string;
}

export interface CardPayload {
  number: string;
  exp_month: number;
  exp_year: number;
  cvc: string;
  name: string;
}

export interface ShopifyCheckoutRequest {
  store_url: string;
  storefront_password?: string;
  items: { variant_id: number; quantity: number }[];
  shipping: ShippingProfile;
  card: CardPayload;
  /**
   * Exact expected total in minor units (products + shipping + tax).
   * The adapter refuses to enter the card on any mismatch.
   */
  expected_total_minor: number;
  /** Directory for evidence artifacts (screenshot, DOM snapshot). */
  evidence_dir: string;
  /**
   * Path for persisted session cookies. Reusing the session across runs
   * avoids re-submitting the storefront password every time (dev stores
   * throttle repeated password submissions).
   */
  session_state_path?: string;
  /** Run headed for debugging. */
  headed?: boolean;
  timeout_ms?: number;
}

export type CheckoutStage =
  | 'password_gate'
  | 'cart'
  | 'checkout_load'
  | 'contact_shipping'
  | 'preflight_total'
  | 'payment'
  | 'confirmation';

export interface ShopifyCheckoutSuccess {
  ok: true;
  rung: 'L1';
  order_confirmation: string;
  total_minor: number;
  evidence: {
    dom_sha256: string;
    screenshot_sha256: string;
    dom_path: string;
    screenshot_path: string;
  };
}

export interface ShopifyCheckoutFailure {
  ok: false;
  rung: 'L1';
  stage: CheckoutStage;
  reason:
    | 'password_rejected'
    | 'cart_failed'
    | 'checkout_unreachable'
    | 'form_mismatch'
    | 'price_mismatch'
    | 'out_of_stock'
    | 'blocked_by_merchant'
    | 'payment_declined'
    | 'confirmation_missing';
  detail: string;
  /** Actual displayed total when reason is price_mismatch. */
  displayed_total_minor?: number;
}

export type ShopifyCheckoutResult = ShopifyCheckoutSuccess | ShopifyCheckoutFailure;

/** Quote pass: same walk as checkout, but stops before any card entry. */
export interface ShopifyQuoteRequest {
  store_url: string;
  storefront_password?: string;
  items: { variant_id: number; quantity: number }[];
  shipping: ShippingProfile;
  session_state_path?: string;
  headed?: boolean;
  timeout_ms?: number;
}

export type ShopifyQuoteResult =
  | { ok: true; rung: 'L1'; cart: NormalizedCart }
  | ShopifyCheckoutFailure;

function fail(
  stage: CheckoutStage,
  reason: ShopifyCheckoutFailure['reason'],
  detail: string,
  extra: Partial<ShopifyCheckoutFailure> = {},
): ShopifyCheckoutFailure {
  return { ok: false, rung: 'L1', stage, reason, detail, ...extra };
}

/** Parse a money string like "€34,00", "34,00 €", "EUR 34.00" to minor units. */
export function parseDisplayedMoney(text: string): number | null {
  // normalize non-breaking and narrow-no-break spaces (common in EUR prices)
  const normalized = text.replace(/[\u00a0\u202f]/g, ' ');
  const m = /([0-9][0-9.,\s]*[0-9]|[0-9])/.exec(normalized);
  if (!m || m[1] === undefined) return null;
  let digits = m[1].replace(/[\s]/g, '');
  // last separator is the decimal separator (if followed by exactly 2 digits)
  const lastSep = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  if (lastSep >= 0 && digits.length - lastSep - 1 === 2) {
    const whole = digits.slice(0, lastSep).replace(/[.,]/g, '');
    const frac = digits.slice(lastSep + 1);
    return Number(whole) * 100 + Number(frac);
  }
  digits = digits.replace(/[.,]/g, '');
  return Number(digits) * 100;
}

async function passPasswordGate(
  page: Page,
  password: string | undefined,
): Promise<true | ShopifyCheckoutFailure> {
  if (!page.url().includes('/password')) return true;
  if (!password)
    return fail(
      'password_gate',
      'password_rejected',
      'store is password-protected and no password was configured',
    );
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[type="submit"], input[type="submit"]'),
  ]);
  if (page.url().includes('/password')) {
    return fail('password_gate', 'password_rejected', 'storefront password was rejected');
  }
  return true;
}

async function detectChallenge(page: Page): Promise<boolean> {
  const html = (await page.content()).toLowerCase();
  return html.includes('hcaptcha') || html.includes('cf-challenge') || html.includes('recaptcha');
}

async function launch(opts: { session_state_path?: string; headed?: boolean }): Promise<{
  browser: Awaited<ReturnType<typeof chromium.launch>>;
  context: BrowserContext;
  page: Page;
}> {
  const browser = await chromium.launch({ headless: !opts.headed });
  let storageState: string | undefined;
  if (opts.session_state_path) {
    try {
      await (await import('node:fs/promises')).access(opts.session_state_path);
      storageState = opts.session_state_path;
    } catch {
      // first run: no session yet
    }
  }
  const context = await browser.newContext({
    userAgent: MOLT_USER_AGENT,
    locale: 'de-DE',
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  return { browser, context, page };
}

/**
 * The shared walk up to (never including) card entry: password gate, cart
 * build via the documented AJAX API, checkout load, contact + shipping,
 * extraction of line items and the displayed total. Quote and checkout run
 * the exact same path, so the cart a mandate is scoped to is the cart the
 * commit pass sees.
 */
async function prepareCheckout(
  page: Page,
  context: BrowserContext,
  req: ShopifyQuoteRequest,
): Promise<{ cart: NormalizedCart } | ShopifyCheckoutFailure> {
  const origin = new URL(req.store_url).origin;
  const timeout = req.timeout_ms ?? 90_000;

  {
    // --- password gate -----------------------------------------------------
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout });
    const gate = await passPasswordGate(page, req.storefront_password);
    if (gate !== true) return gate;
    if (req.session_state_path) {
      await context.storageState({ path: req.session_state_path });
    }

    // --- cart via the documented AJAX API, executed in-page ----------------
    // (the browser's own fetch: full session context, honest UA - Shopify
    // throttles bare API clients on protected storefronts)
    const rawCartCall = (path: string, payload?: unknown) =>
      page.evaluate(
        async ([p, body]) => {
          const res = await fetch(p as string, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? null : JSON.stringify(body),
          });
          return {
            status: res.status,
            retryAfter: Number(res.headers.get('retry-after') ?? '0'),
            text: (await res.text()).slice(0, 300),
          };
        },
        [path, payload] as const,
      );

    /**
     * Merchants throttle; a well-behaved client waits instead of hammering.
     * Honors Retry-After, otherwise exponential backoff. This is the polite
     * counterpart to the Stamp: identify honestly, back off when asked.
     */
    const cartCall = async (path: string, payload?: unknown) => {
      let last = await rawCartCall(path, payload);
      // up to ~2 minutes of patience: storefront throttles are measured in
      // minutes, and waiting is always the honest answer
      for (let attempt = 1; attempt <= 6 && last.status === 429; attempt++) {
        const waitMs =
          last.retryAfter > 0 ? last.retryAfter * 1000 : Math.min(2000 * 2 ** attempt, 30_000);
        await page.waitForTimeout(waitMs);
        last = await rawCartCall(path, payload);
      }
      return last;
    };

    const clear = await cartCall('/cart/clear.js');
    if (clear.status !== 200) {
      return fail('cart', 'cart_failed', `cart clear failed (${clear.status})`);
    }
    for (const item of req.items) {
      const add = await cartCall('/cart/add.js', { id: item.variant_id, quantity: item.quantity });
      if (add.status !== 200) {
        const soldOut = add.text.toLowerCase().includes('sold out') || add.status === 422;
        return fail(
          'cart',
          soldOut ? 'out_of_stock' : 'cart_failed',
          `add to cart failed for variant ${item.variant_id}: ${add.status} ${add.text.slice(0, 200)}`,
        );
      }
    }

    // read the cart back from the documented endpoint: line items, unit
    // prices and subtotal in minor units - no DOM guessing
    const cartJson = (await page.evaluate(async () => {
      const res = await fetch('/cart.js');
      return res.ok ? await res.json() : null;
    })) as {
      currency: string;
      items_subtotal_price: number;
      items: {
        variant_id: number;
        quantity: number;
        title: string;
        product_title?: string;
        final_price?: number;
        price: number;
      }[];
    } | null;
    if (!cartJson || !Array.isArray(cartJson.items) || cartJson.items.length === 0) {
      return fail('cart', 'cart_failed', 'could not read /cart.js after building the cart');
    }

    // --- checkout ----------------------------------------------------------
    await page.goto(`${origin}/checkout`, { waitUntil: 'domcontentloaded', timeout });
    if (await detectChallenge(page)) {
      return fail(
        'checkout_load',
        'blocked_by_merchant',
        'bot challenge on checkout; failing honestly per the Stamp',
      );
    }

    // contact + shipping (modern one-page checkout; fields render async and
    // appear twice - shipping + billing - so wait, then always take the first)
    try {
      await page.waitForSelector('select[name="countryCode"]:visible', { timeout: 30_000 });
      // fields exist twice (shipping + billing) plus hidden SSR shells:
      // always target the first VISIBLE instance
      const first = (sel: string) => page.locator(`${sel}:visible`).first();
      await first('input[name="email"]').fill(req.shipping.email);
      // fail fast and explain when the store does not ship to the target country
      const available = await first('select[name="countryCode"]').evaluate((el) =>
        Array.from(
          (el as unknown as { options: ArrayLike<{ value: string }> }).options,
          (o) => o.value,
        ),
      );
      if (!available.includes(req.shipping.country_code)) {
        return fail(
          'contact_shipping',
          'form_mismatch',
          `store does not ship to ${req.shipping.country_code}; offered countries: ${available.join(', ')}`,
        );
      }
      await first('select[name="countryCode"]').selectOption(req.shipping.country_code);
      await first('input[name="firstName"]').fill(req.shipping.first_name);
      await first('input[name="lastName"]').fill(req.shipping.last_name);
      await first('input[name="address1"]').fill(req.shipping.address1);
      await first('input[name="city"]').fill(req.shipping.city);
      const zip = first('input[name="postalCode"]');
      if (await zip.count()) await zip.fill(req.shipping.zip);
      const phone = first('input[name="phone"]');
      if ((await phone.count()) && req.shipping.phone) await phone.fill(req.shipping.phone);
    } catch (e) {
      return fail(
        'contact_shipping',
        'form_mismatch',
        `shipping form did not match expectations: ${e instanceof Error ? e.message : e}`,
      );
    }

    // some themes require an account -> honest failure, not a workaround
    if ((await page.locator('text=/log in to continue|sign in to continue/i').count()) > 0) {
      return fail(
        'contact_shipping',
        'form_mismatch',
        'checkout requires a merchant account; failing gracefully',
      );
    }

    // --- displayed total ----------------------------------------------------
    await page.waitForTimeout(1500); // totals settle after address entry
    const totalText = await page
      .locator('css=[role="row"]:has-text("Total"), div:has-text("Total") >> nth=-1')
      .last()
      .innerText()
      .catch(() => '');
    const displayed = parseDisplayedMoney(totalText.split('\n').reverse().join(' '));
    if (displayed === null) {
      return fail(
        'preflight_total',
        'price_mismatch',
        `could not read displayed total (got: ${totalText.slice(0, 120)})`,
      );
    }

    const subtotal = cartJson.items_subtotal_price;
    return {
      cart: {
        merchant_origin: origin,
        currency: cartJson.currency.toUpperCase(),
        lines: cartJson.items.map((i) => ({
          variant_id: i.variant_id,
          title: i.product_title ?? i.title,
          quantity: i.quantity,
          price_minor: i.final_price ?? i.price,
        })),
        subtotal_minor: subtotal,
        // Dev-store prices are tax-inclusive; whatever checkout adds on top
        // of the items subtotal (shipping, any non-included tax) lands here
        // so subtotal + shipping = total stays a checkable invariant.
        shipping_minor: displayed - subtotal,
        total_minor: displayed,
      },
    };
  }
}

/**
 * Quote pass (the OT-054 wiring): walk to the checkout page WITHOUT a card
 * and return the normalized cart. The child mandate gets scoped to this
 * cart's hash; the commit pass must reproduce it exactly.
 */
export async function shopifyQuote(req: ShopifyQuoteRequest): Promise<ShopifyQuoteResult> {
  const { browser, context, page } = await launch(req);
  try {
    const prepared = await prepareCheckout(page, context, req);
    if ('ok' in prepared) return prepared;
    return { ok: true, rung: 'L1', cart: prepared.cart };
  } finally {
    await browser.close();
  }
}

export async function shopifyCheckout(req: ShopifyCheckoutRequest): Promise<ShopifyCheckoutResult> {
  const timeout = req.timeout_ms ?? 90_000;
  const { browser, context, page } = await launch(req);

  try {
    const prepared = await prepareCheckout(page, context, req);
    if ('ok' in prepared) return prepared;

    // --- preflight: total must match EXACTLY before any card entry --------
    const displayed = prepared.cart.total_minor;
    if (displayed !== req.expected_total_minor) {
      return fail(
        'preflight_total',
        'price_mismatch',
        `displayed total ${displayed} != expected ${req.expected_total_minor}; refusing before card entry`,
        { displayed_total_minor: displayed },
      );
    }

    // --- payment: card fields live in iframes ------------------------------
    try {
      const cardFrame = (prefix: string) =>
        page.frameLocator(`iframe[name^="card-fields-${prefix}-"]`);
      await cardFrame('number').locator('input[name="number"]').fill(req.card.number);
      await cardFrame('expiry')
        .locator('input[name="expiry"]')
        .fill(
          `${String(req.card.exp_month).padStart(2, '0')}/${String(req.card.exp_year).slice(-2)}`,
        );
      await cardFrame('verification_value')
        .locator('input[name="verification_value"]')
        .fill(req.card.cvc);
      const nameInput = cardFrame('name').locator('input[name="name"]');
      if ((await nameInput.count()) > 0) await nameInput.fill(req.card.name);
    } catch (e) {
      return fail(
        'payment',
        'form_mismatch',
        `card fields did not match expectations: ${e instanceof Error ? e.message : e}`,
      );
    }

    const payButton = page.locator(
      'button:has-text("Pay now"), button:has-text("Jetzt bezahlen"), button#checkout-pay-button',
    );
    await payButton.first().click();

    // --- confirmation -------------------------------------------------------
    try {
      await page.waitForURL(/thank[-_]?you|orders\//i, { timeout });
    } catch {
      const declined = await page
        .locator('text=/declined|abgelehnt|could not be processed/i')
        .count();
      if (declined > 0) {
        return fail('payment', 'payment_declined', 'gateway declined the card');
      }
      return fail(
        'confirmation',
        'confirmation_missing',
        `no confirmation page reached (at ${page.url()})`,
      );
    }

    const confirmation =
      (await page
        .locator('text=/confirmation #|order #|bestellung #|bestellnummer/i')
        .first()
        .innerText()
        .catch(() => '')) || page.url();

    // --- evidence -----------------------------------------------------------
    await mkdir(req.evidence_dir, { recursive: true });
    const stamp = Date.now();
    const dom = await page.content();
    const domPath = join(req.evidence_dir, `confirmation-${stamp}.html`);
    await writeFile(domPath, dom, 'utf8');
    const screenshotPath = join(req.evidence_dir, `confirmation-${stamp}.png`);
    const screenshot = await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      ok: true,
      rung: 'L1',
      order_confirmation: confirmation.trim(),
      total_minor: req.expected_total_minor,
      evidence: {
        dom_sha256: createHash('sha256').update(dom).digest('hex'),
        screenshot_sha256: createHash('sha256').update(screenshot).digest('hex'),
        dom_path: domPath,
        screenshot_path: screenshotPath,
      },
    };
  } finally {
    await browser.close();
  }
}
