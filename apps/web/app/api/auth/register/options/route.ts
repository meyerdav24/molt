import { generateRegistrationOptions } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
import { setChallenge } from '../../../../../lib/session';
import { rpConfig } from '../../../../../lib/webauthn';

export const runtime = 'nodejs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email || !EMAIL.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const { rpID, rpName } = rpConfig();

  // Exclude credentials this user already registered.
  const existing = await db()<{ credential_id: string; transports: string[] }[]>`
    select c.credential_id, c.transports
    from credentials c
    join users u on u.id = c.user_id
    where u.email = ${email}`;

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: email,
    attestationType: 'none',
    authenticatorSelection: {
      // Platform authenticator (Touch ID / Windows Hello / Android biometric)
      // per OT-020; without this hint browsers lead with the cross-device QR.
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'preferred',
    },
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports as never,
    })),
  });

  await setChallenge({ kind: 'register', challenge: options.challenge, email });
  return NextResponse.json(options);
}
