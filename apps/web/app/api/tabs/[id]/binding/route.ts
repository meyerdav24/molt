import { NextResponse } from 'next/server';
import type { MandateBounds, StepUpPolicy } from '@molt/protocol';
import { db } from '../../../../../lib/db';
import { mandateChallengeHex, verifyMandateBinding } from '../../../../../lib/mandate-binding';
import { getSessionUserId } from '../../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tamper check (OT-021 AC): recompute the mandate hash from the STORED
 * bounds and compare it against the challenge inside the STORED assertion.
 * If anyone edited the bounds after the ceremony, this returns bound: false.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const [root] = await db()<
    {
      bounds: MandateBounds;
      task_declaration: string;
      step_up_policy: StepUpPolicy;
      webauthn_assertion: { response?: { clientDataJSON?: string } };
      challenge_hash: string;
    }[]
  >`select m.bounds, m.task_declaration, m.step_up_policy, m.webauthn_assertion, m.challenge_hash
    from mandates m
    join tabs t on t.id = m.tab_id
    where m.tab_id = ${params.id} and m.kind = 'root' and t.user_id = ${userId}`;
  if (!root) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const doc = {
    bounds: root.bounds,
    task_declaration: root.task_declaration,
    step_up_policy: root.step_up_policy,
  };
  const recomputedHex = mandateChallengeHex(doc);

  return NextResponse.json({
    bound: verifyMandateBinding(doc, root.webauthn_assertion),
    stored_challenge_hash: root.challenge_hash,
    recomputed_challenge_hash: recomputedHex,
  });
}
