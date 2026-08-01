import { db } from '../../../lib/db';
import { expireHeldIfDue } from '../../../lib/mandates';
import { verifyStepUpToken } from '../../../lib/step-up';
import { StepUpClient } from './step-up-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The step-up approval page (OT-024/OT-071): what the email link opens.
 * Optimized for a 10-second mobile interaction. No session required - the
 * token proves email receipt, and approval itself requires the tab owner's
 * passkey (the link alone can never approve).
 */
export default async function StepUpPage({ params }: { params: { token: string } }) {
  const wrap = (children: React.ReactNode) => (
    <main
      style={{ maxWidth: 420, margin: '3rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1>Molt</h1>
      {children}
    </main>
  );

  const mandateId = await verifyStepUpToken(params.token);
  if (!mandateId) {
    return wrap(<p>This approval link is invalid or has expired. Nothing was approved.</p>);
  }

  await expireHeldIfDue(mandateId);

  const sql = db();
  const [m] = await sql<
    {
      id: string;
      status: string;
      amount_minor: string;
      currency: string;
      merchant_scope: string;
      reason: string | null;
      expires_at: string;
    }[]
  >`select id, status, amount_minor, currency, merchant_scope, reason, expires_at
    from mandates where id = ${mandateId} and kind = 'child'`;
  if (!m) return wrap(<p>This approval request no longer exists.</p>);

  if (m.status !== 'held') {
    const text: Record<string, string> = {
      approved: 'This purchase was already approved.',
      denied: 'This purchase was denied. The agent cannot use it.',
      expired: 'This request expired and was cancelled automatically. The budget was returned.',
      consumed: 'This purchase already completed.',
    };
    return wrap(<p>{text[m.status] ?? `Request state: ${m.status}.`}</p>);
  }

  const [trigger] = await sql<{ payload: { triggers?: { reason: string }[] } }[]>`
    select payload from events
    where mandate_id = ${m.id} and type = 'mandate.held'
    order by id desc limit 1`;

  return wrap(
    <StepUpClient
      token={params.token}
      merchant={m.merchant_scope}
      amount={`${(Number(m.amount_minor) / 100).toFixed(2)} ${m.currency}`}
      reason={m.reason ?? ''}
      triggers={(trigger?.payload.triggers ?? []).map((t) => t.reason)}
      expiresAt={m.expires_at}
    />,
  );
}
