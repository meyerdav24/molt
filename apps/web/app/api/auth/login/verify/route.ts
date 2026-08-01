import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { consumeChallenge, createSession } from '../../../../../lib/session';
import { rpConfig } from '../../../../../lib/webauthn';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const response = (await req.json().catch(() => null)) as AuthenticationResponseJSON | null;
  if (!response?.id) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const pending = await consumeChallenge('login');
  if (!pending) return NextResponse.json({ error: 'no_pending_challenge' }, { status: 400 });

  const sql = db();
  const [cred] = await sql<
    {
      id: string;
      user_id: string;
      credential_id: string;
      public_key: Buffer;
      counter: string;
      transports: string[];
    }[]
  >`select id, user_id, credential_id, public_key, counter, transports
    from credentials where credential_id = ${response.id}`;
  if (!cred) return NextResponse.json({ error: 'unknown_credential' }, { status: 400 });

  const { rpID, origin } = rpConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(cred.public_key),
        counter: Number(cred.counter),
        transports: cred.transports as never,
      },
      requireUserVerification: false,
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
  await sql`
    insert into events (user_id, actor, type, payload)
    values (${cred.user_id}, 'user', 'auth.login', ${sql.json({ credential_id: cred.credential_id })})`;

  await createSession(cred.user_id);
  return NextResponse.json({ ok: true });
}
