import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Opening a tab is a human act (OT-025): the agent can never self-authorize.
 * This returns the ceremony URL for the human to complete with a passkey.
 */
export function POST() {
  const base = process.env.MOLT_PUBLIC_URL ?? 'http://localhost:3000';
  return NextResponse.json({
    ceremony_url: `${base}/tabs/new`,
    message: 'open this URL as the human owner and complete the passkey ceremony',
  });
}
