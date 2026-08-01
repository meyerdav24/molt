import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { hexToBytes } from '../../../../lib/mandate-binding';
import { expireHeldIfDue } from '../../../../lib/mandates';
import { setChallenge } from '../../../../lib/session';
import {
  amendmentChallengeHex,
  verifyStepUpToken,
  type TapAmendment,
} from '../../../../lib/step-up';
import { rpConfig } from '../../../../lib/webauthn';

export const runtime = 'nodejs';

/**
 * WebAuthn options for a Tap approval: challenge = SHA-256 of the canonical
 * amendment document, credentials restricted to the tab owner's passkeys.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  const mandateId = body?.token ? await verifyStepUpToken(body.token) : null;
  if (!mandateId) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });

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

  const creds = await sql<{ credential_id: string; transports: string[] }[]>`
    select credential_id, transports from credentials where user_id = ${m.user_id}`;
  if (creds.length === 0) return NextResponse.json({ error: 'no_passkey' }, { status: 400 });

  const amendment: TapAmendment = {
    kind: 'tap_amendment',
    action: 'approve_child',
    tab_id: m.tab_id,
    mandate_id: m.id,
    amount_minor: Number(m.amount_minor),
    merchant_scope: m.merchant_scope,
    cart_hash: m.cart_hash,
  };

  const { rpID } = rpConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    challenge: hexToBytes(amendmentChallengeHex(amendment)),
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: c.transports as never,
    })),
  });

  await setChallenge({
    kind: 'stepup',
    challenge: options.challenge,
    payload: { mandate_id: m.id },
  });
  return NextResponse.json(options);
}
