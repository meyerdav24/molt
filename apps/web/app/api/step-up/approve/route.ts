import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { bytesToBase64Url, hexToBytes } from '../../../../lib/mandate-binding';
import { expireHeldIfDue } from '../../../../lib/mandates';
import { consumeChallenge } from '../../../../lib/session';
import {
  amendmentChallengeHex,
  verifyStepUpToken,
  type TapAmendment,
} from '../../../../lib/step-up';
import { rpConfig } from '../../../../lib/webauthn';

export const runtime = 'nodejs';

/**
 * Approve a held mandate (the Tap, OT-024). The assertion signs an amendment
 * to the tab - challenge recomputed from the stored mandate, never trusted
 * from the client - and must come from a passkey of the tab owner with fresh
 * user verification. The amendment assertion is stored on the child mandate
 * for offline re-verification, mirroring the ceremony binding.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    token?: string;
    assertion?: AuthenticationResponseJSON;
  } | null;
  const mandateId = body?.token ? await verifyStepUpToken(body.token) : null;
  if (!mandateId || !body?.assertion?.id) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const pending = await consumeChallenge('stepup');
  const pendingMandate = (pending?.payload as { mandate_id?: string } | undefined)?.mandate_id;
  if (!pending || pendingMandate !== mandateId) {
    return NextResponse.json({ error: 'no_pending_challenge' }, { status: 400 });
  }

  await expireHeldIfDue(mandateId);

  const sql = db();
  const [m] = await sql<
    {
      id: string;
      tab_id: string;
      status: string;
      amount_minor: string;
      merchant_scope: string;
      cart_hash: string;
      user_id: string;
    }[]
  >`select m.id, m.tab_id, m.status, m.amount_minor, m.merchant_scope, m.cart_hash, t.user_id
    from mandates m join tabs t on t.id = m.tab_id
    where m.id = ${mandateId} and m.kind = 'child'`;
  if (!m) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (m.status !== 'held') {
    return NextResponse.json({ error: 'not_held', status: m.status }, { status: 409 });
  }

  // The credential must belong to the tab owner.
  const [cred] = await sql<
    {
      id: string;
      credential_id: string;
      public_key: Buffer;
      counter: string;
      transports: string[];
    }[]
  >`select id, credential_id, public_key, counter, transports
    from credentials where credential_id = ${body.assertion.id} and user_id = ${m.user_id}`;
  if (!cred) return NextResponse.json({ error: 'unknown_credential' }, { status: 400 });

  const amendment: TapAmendment = {
    kind: 'tap_amendment',
    action: 'approve_child',
    tab_id: m.tab_id,
    mandate_id: m.id,
    amount_minor: Number(m.amount_minor),
    merchant_scope: m.merchant_scope,
    cart_hash: m.cart_hash,
  };
  const challengeHex = amendmentChallengeHex(amendment);
  const expectedChallenge = bytesToBase64Url(hexToBytes(challengeHex));

  const { rpID, origin } = rpConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.assertion,
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

  await sql.begin(async (tx) => {
    await tx`
      update credentials
      set counter = ${verification.authenticationInfo.newCounter}, last_used_at = now()
      where id = ${cred.id}`;
    await tx`
      update mandates
      set status = 'approved',
          webauthn_assertion = ${tx.json(body.assertion as never)},
          challenge_hash = ${challengeHex}
      where id = ${m.id} and status = 'held'`;
    await tx`
      insert into events (tab_id, mandate_id, user_id, actor, type, payload)
      values (${m.tab_id}, ${m.id}, ${m.user_id}, 'user', 'mandate.approved',
              ${tx.json({ amendment: amendment as never, challenge_hash: challengeHex })})`;
  });

  return NextResponse.json({ ok: true, status: 'approved' });
}
