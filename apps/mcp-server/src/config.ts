/**
 * MCP server configuration (OT-040). Everything comes from the environment
 * the agent host passes in (Claude Desktop config, docker env, shell):
 *
 *   MOLT_API_URL                 Tab Authority base URL (default http://localhost:3000)
 *   MOLT_AGENT_KEY               tab-scoped agent key (molt_sk_test_...); created by
 *                                the human in the dashboard after the ceremony
 *   MOLT_SHIPPING_PROFILE        JSON shipping profile for checkouts (the agent
 *                                operator's delivery address)
 *   MOLT_STOREFRONT_PASSWORDS    host|password[,host|password] for password-
 *                                protected dev stores (authorized access to the
 *                                operator's own test stores)
 *   MOLT_AGENT_SIGNING_KEY_PATH  ed25519 PEM for receipt signing
 *                                (default ~/.molt/agent-signing-key.pem, auto-created)
 *   MOLT_EVIDENCE_DIR            evidence artifacts (default ~/.molt/evidence)
 *   MOLT_HEADED                  set to 1 to run checkouts headed (debugging)
 *   MOLT_BOGUS_GATEWAY_HOSTS     comma-separated dev-store hosts whose checkout
 *                                runs Shopify's Bogus Gateway. Test-mode Issuing
 *                                cards cannot be charged across Stripe accounts,
 *                                so on these hosts the checkout enters the Bogus
 *                                success card instead of the shell's number. The
 *                                shell itself stays fully real: minted, scoped,
 *                                delivered once, shed after use.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ShippingProfile } from '@molt/adapters';

export interface MoltConfig {
  apiUrl: string;
  agentKey: string | undefined;
  shipping: ShippingProfile | undefined;
  storefrontPasswords: Map<string, string>;
  bogusGatewayHosts: Set<string>;
  signingKeyPath: string;
  evidenceDir: string;
  headed: boolean;
}

const SHIPPING_REQUIRED: (keyof ShippingProfile)[] = [
  'email',
  'first_name',
  'last_name',
  'address1',
  'city',
  'zip',
  'country_code',
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MoltConfig {
  const agentKey = env.MOLT_AGENT_KEY;
  if (agentKey !== undefined && !agentKey.startsWith('molt_sk_test_')) {
    // G1: test mode only. A key with any other prefix is refused at boot.
    throw new Error('MOLT_AGENT_KEY must be a test-mode key (molt_sk_test_...)');
  }

  let shipping: ShippingProfile | undefined;
  if (env.MOLT_SHIPPING_PROFILE) {
    const parsed = JSON.parse(env.MOLT_SHIPPING_PROFILE) as ShippingProfile;
    const missing = SHIPPING_REQUIRED.filter((k) => !parsed[k]);
    if (missing.length > 0) {
      throw new Error(`MOLT_SHIPPING_PROFILE is missing: ${missing.join(', ')}`);
    }
    shipping = parsed;
  }

  const storefrontPasswords = new Map<string, string>();
  for (const entry of (env.MOLT_STOREFRONT_PASSWORDS ?? '').split(',')) {
    const [host, password] = entry.trim().split('|');
    if (host && password) storefrontPasswords.set(host.toLowerCase(), password);
  }

  const bogusGatewayHosts = new Set(
    (env.MOLT_BOGUS_GATEWAY_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );

  const moltHome = join(homedir(), '.molt');
  return {
    apiUrl: (env.MOLT_API_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    agentKey,
    shipping,
    storefrontPasswords,
    bogusGatewayHosts,
    signingKeyPath: env.MOLT_AGENT_SIGNING_KEY_PATH ?? join(moltHome, 'agent-signing-key.pem'),
    evidenceDir: env.MOLT_EVIDENCE_DIR ?? join(moltHome, 'evidence'),
    headed: env.MOLT_HEADED === '1',
  };
}
