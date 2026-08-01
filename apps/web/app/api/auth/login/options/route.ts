import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { setChallenge } from '../../../../../lib/session';
import { rpConfig } from '../../../../../lib/webauthn';

export const runtime = 'nodejs';

/**
 * Usernameless login: resident keys are required at registration, so the
 * authenticator offers the right passkey without an email prompt.
 */
export async function POST() {
  const { rpID } = rpConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: [],
  });
  await setChallenge({ kind: 'login', challenge: options.challenge });
  return NextResponse.json(options);
}
