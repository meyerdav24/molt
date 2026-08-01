import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import type { MandateBounds, StepUpAction, StepUpPolicy } from '@molt/protocol';
import { db } from '../../../../../lib/db';
import {
  hexToBytes,
  mandateChallengeHex,
  type RootMandateDoc,
} from '../../../../../lib/mandate-binding';
import { mccsForCategories } from '../../../../../lib/mcc';
import { getSessionUserId, setChallenge } from '../../../../../lib/session';
import { rpConfig } from '../../../../../lib/webauthn';

export const runtime = 'nodejs';

interface CeremonyRequest {
  total_minor: number;
  per_tx_max_minor: number;
  duration_days: number;
  categories: string[];
  merchant_denylist?: string[];
  velocity_per_hour: number;
  task_declaration: string;
  step_up_policy: StepUpPolicy;
}

const ACTIONS: StepUpAction[] = ['allow', 'notify', 'require_tap', 'block'];
const TRIGGERS = [
  'unknown_merchant',
  'amount_above_baseline',
  'mcc_outside_allowlist',
  'velocity_exceeded',
] as const;

function parse(body: unknown): { doc: RootMandateDoc } | { error: string } {
  const b = body as CeremonyRequest;
  const isPosInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

  if (!isPosInt(b?.total_minor)) return { error: 'total_minor must be a positive integer' };
  if (!isPosInt(b.per_tx_max_minor) || b.per_tx_max_minor > b.total_minor)
    return { error: 'per_tx_max_minor must be a positive integer <= total' };
  if (!isPosInt(b.duration_days) || b.duration_days > 90)
    return { error: 'duration_days must be 1..90' };
  if (!Array.isArray(b.categories) || b.categories.length === 0)
    return { error: 'at least one category required' };
  if (!isPosInt(b.velocity_per_hour) || b.velocity_per_hour > 60)
    return { error: 'velocity_per_hour must be 1..60' };
  if (typeof b.task_declaration !== 'string' || !b.task_declaration.trim())
    return { error: 'task_declaration required' };
  for (const t of TRIGGERS) {
    if (!ACTIONS.includes(b.step_up_policy?.[t])) return { error: `step_up_policy.${t} invalid` };
  }
  const denylist = (b.merchant_denylist ?? []).map((s) => s.trim()).filter(Boolean);

  let mccs: string[];
  try {
    mccs = mccsForCategories(b.categories);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'invalid categories' };
  }

  const bounds: MandateBounds = {
    amount_minor: b.total_minor,
    currency: 'EUR',
    per_tx_max_minor: b.per_tx_max_minor,
    expires_at: new Date(Date.now() + b.duration_days * 24 * 3600_000).toISOString(),
    mcc_allowlist: mccs,
    velocity_per_hour: b.velocity_per_hour,
    merchant_scope: '*',
    ...(denylist.length > 0 ? { merchant_denylist: denylist } : {}),
  };

  return {
    doc: {
      bounds,
      task_declaration: b.task_declaration.trim(),
      step_up_policy: b.step_up_policy,
    },
  };
}

/**
 * Step 1 of the Open Tab ceremony: validate the requested bounds, derive the
 * challenge as SHA-256 of the canonical mandate document, and return
 * authentication options restricted to the user's registered passkeys.
 */
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = parse(await req.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const creds = await db()<{ credential_id: string; transports: string[] }[]>`
    select credential_id, transports from credentials where user_id = ${userId}`;
  if (creds.length === 0) {
    return NextResponse.json({ error: 'no_registered_passkey' }, { status: 400 });
  }

  const challengeHex = mandateChallengeHex(parsed.doc);
  const { rpID } = rpConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    challenge: hexToBytes(challengeHex),
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: c.transports as never,
    })),
  });

  await setChallenge({ kind: 'ceremony', challenge: options.challenge, payload: parsed.doc });
  return NextResponse.json(options);
}
