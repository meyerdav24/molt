/**
 * WebAuthn relying-party config (OT-020). The RP ID derives from
 * MOLT_PUBLIC_URL — passkeys are bound to this hostname.
 *
 * G3: this ceremony authenticates the user to Molt for mandate signing
 * only. It is not SCA, and no issuer may rely on it as authentication.
 */
export function rpConfig() {
  const base = process.env.MOLT_PUBLIC_URL ?? 'http://localhost:3000';
  const url = new URL(base);
  return { rpID: url.hostname, rpName: 'Molt', origin: url.origin };
}
