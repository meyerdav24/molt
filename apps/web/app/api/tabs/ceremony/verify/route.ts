import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { ensureCardholder } from '../../../../../lib/cardholder';
import { db } from '../../../../../lib/db';
import {
  mandateChallengeBase64Url,
  mandateChallengeHex,
  type RootMandateDoc,
} from '../../../../../lib/mandate-binding';
import { consumeChallenge, getSessionUserId } from '../../../../../lib/session';
import { rpConfig } from '../../../../../lib/webauthn';

export const runtime = 'nodejs';

/**
 * Step 2 of the Open Tab ceremony: verify the fresh assertion against the
 * mandate-derived challenge, then create the tab + root mandate. The stored
 * assertion binds the passkey ceremony to these exact bounds (OT-021).
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // OT-120 entitlement: the free tier gets one active hosted tab. Enforced
  // before anything else so the refusal is clean and the ceremony cookie
  // stays untouched.
  const sqlEarly = db();
  const [account] = await sqlEarly<{ tier: string }[]>`
    select tier from users where id = ${userId}`;
  if (account?.tier === 'free') {
    const [activeTabs] = await sqlEarly<{ n: number }[]>`
      select count(*)::int as n from tabs where user_id = ${userId} and status = 'active'`;
    if ((activeTabs?.n ?? 0) >= 1) {
      return NextResponse.json(
        {
          error: 'tier_limit',
          detail: 'the free tier includes one active hosted tab; revoke it or upgrade',
          pricing: '/pricing',
        },
        { status: 403 },
      );
    }
  }

  const response = (await req.json().catch(() => null)) as AuthenticationResponseJSON | null;
  if (!response?.id) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const pending = await consumeChallenge('ceremony');
  if (!pending?.payload) {
    return NextResponse.json({ error: 'no_pending_ceremony' }, { status: 400 });
  }
  const doc = pending.payload as RootMandateDoc;

  // The challenge MUST equal the hash of the pending mandate document —
  // recompute rather than trust the cookie value.
  const expectedChallenge = mandateChallengeBase64Url(doc);
  if (expectedChallenge !== pending.challenge) {
    return NextResponse.json({ error: 'challenge_mismatch' }, { status: 400 });
  }

  const sql = db();
  const [cred] = await sql<
    {
      id: string;
      credential_id: string;
      public_key: Buffer;
      counter: string;
      transports: string[];
    }[]
  >`select id, credential_id, public_key, counter, transports
    from credentials where credential_id = ${response.id} and user_id = ${userId}`;
  if (!cred) return NextResponse.json({ error: 'unknown_credential' }, { status: 400 });

  const { rpID, origin } = rpConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(cred.public_key),
        counter: Number(cred.counter),
        transports: cred.transports as never,
      },
      requireUserVerification: true,
    });
  } catch {
    return NextResponse.json({ error: 'verification_failed' }, { status: 400 });
  }
  if (!verification.verified) {
    return NextResponse.json({ error: 'verification_failed' }, { status: 400 });
  }

  await sql`
    update credentials
    set counter = ${verification.authenticationInfo.newCounter}, last_used_at = now()
    where id = ${cred.id}`;

  const challengeHex = mandateChallengeHex(doc);

  const [tab] = await sql.begin(async (tx) => {
    const [t] = await tx<{ id: string }[]>`
      insert into tabs (user_id, currency, total_minor, remaining_minor, expires_at)
      values (${userId}, ${doc.bounds.currency}, ${doc.bounds.amount_minor},
              ${doc.bounds.amount_minor}, ${doc.bounds.expires_at})
      returning id`;
    if (!t) throw new Error('tab insert failed');

    await tx`
      insert into mandates
        (tab_id, kind, status, bounds, amount_minor, currency, merchant_scope,
         task_declaration, step_up_policy, webauthn_assertion, challenge_hash, expires_at)
      values
        (${t.id}, 'root', 'active', ${tx.json(doc.bounds as never)},
         ${doc.bounds.amount_minor}, ${doc.bounds.currency}, ${doc.bounds.merchant_scope},
         ${doc.task_declaration}, ${tx.json(doc.step_up_policy as never)},
         ${tx.json(response as never)}, ${challengeHex}, ${doc.bounds.expires_at})`;

    await tx`
      insert into events (tab_id, user_id, actor, type, payload)
      values (${t.id}, ${userId}, 'user', 'tab.opened',
              ${tx.json({
                total_minor: doc.bounds.amount_minor,
                per_tx_max_minor: doc.bounds.per_tx_max_minor,
                expires_at: doc.bounds.expires_at,
                challenge_hash: challengeHex,
              })})`;
    return [t];
  });

  // OT-030: provision the Stripe test cardholder on first tab creation.
  // Best effort - card provisioning retries it if Stripe was unreachable.
  try {
    await ensureCardholder(userId);
  } catch {
    // non-fatal by design
  }

  return NextResponse.json({ ok: true, tab_id: tab?.id });
}
