import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { consumeChallenge, createSession } from '../../../../../lib/session';
import { rpConfig } from '../../../../../lib/webauthn';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const response = (await req.json().catch(() => null)) as RegistrationResponseJSON | null;
  if (!response) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const pending = await consumeChallenge('register');
  if (!pending?.email) {
    return NextResponse.json({ error: 'no_pending_challenge' }, { status: 400 });
  }

  const { rpID, origin } = rpConfig();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch {
    return NextResponse.json({ error: 'verification_failed' }, { status: 400 });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'verification_failed' }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const sql = db();

  const [user] = await sql<{ id: string }[]>`
    insert into users (email) values (${pending.email})
    on conflict (email) do update set updated_at = now()
    returning id`;
  if (!user) return NextResponse.json({ error: 'user_upsert_failed' }, { status: 500 });

  await sql`
    insert into credentials
      (user_id, credential_id, public_key, counter, transports, device_type, backed_up)
    values
      (${user.id}, ${credential.id}, ${Buffer.from(credential.publicKey)},
       ${credential.counter}, ${credential.transports ?? []},
       ${credentialDeviceType}, ${credentialBackedUp})`;

  await sql`
    insert into events (user_id, actor, type, payload)
    values (${user.id}, 'user', 'auth.passkey_registered',
            ${sql.json({ credential_id: credential.id, device_type: credentialDeviceType })})`;

  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
