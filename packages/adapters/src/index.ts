/**
 * Execution ladder adapters (Epic 5, Epic 11). Phase 0 scaffold.
 *
 * Ladder: L0 native protocol (x402 real; ACP/UCP stubbed) → L1 Shopify →
 * L2 Stagehand fallback → L3 deep link handed to the human.
 *
 * The Stamp applies to everything here: RFC 9421 signatures, Tab-Context
 * header, honest user agent. Zero stealth measures — if blocked, fail
 * honestly with `blocked_by_merchant`.
 */
export {
  clearDetectionCache,
  resolveMerchant,
  type DetectionResult,
  type Platform,
} from './detector.js';
export {
  blockedByMerchant,
  buildSignatureBase,
  buildTabContext,
  COVERED_COMPONENTS,
  generateAgentSigningKey,
  MOLT_USER_AGENT,
  signRequest,
  verifyRequest,
  type AgentKeyPair,
  type BlockedByMerchant,
  type SignedHeaders,
  type SignRequestInput,
} from './stamp.js';
export {
  cartHash,
  deriveIdempotencyKey,
  normalizeCart,
  preflightValidate,
  type CartLine,
  type NormalizedCart,
  type PreflightViolation,
} from './preflight.js';
export {
  ALLOWED_NETWORK,
  fetchWithX402,
  parseEnvelope,
  X402_VERSION,
  type PaymentRequirements,
  type SettlementInfo,
  type X402Envelope,
  type X402FailureReason,
  type X402Outcome,
  type X402RequestOptions,
} from './x402.js';
export {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_USDC,
  DEFAULT_RPC_URL,
  initWallet,
  loadWallet,
  usdcBalance,
  walletAddress,
} from './wallet.js';
export {
  parseDisplayedMoney,
  shopifyCheckout,
  shopifyQuote,
  type CardPayload,
  type ShippingProfile,
  type ShopifyCheckoutRequest,
  type ShopifyCheckoutResult,
  type ShopifyQuoteRequest,
  type ShopifyQuoteResult,
} from './shopify.js';
