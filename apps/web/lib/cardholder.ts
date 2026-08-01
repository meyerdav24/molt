/**
 * Cardholder provisioning (OT-030), idempotent.
 *
 * v1 is test-mode only: cardholder identity uses synthetic test data (name
 * derived from the email, fixed test address/phone). No real KYC happens
 * here, deliberately - in any live deployment, KYC is the issuer's job and
 * runs on issuer rails, never inside the TA (guardrails G1-G3). EU accounts
 * require first/last name and a phone number (3DS) even in test mode.
 */
import { db } from './db';
import { stripe } from './stripe';

export async function ensureCardholder(userId: string): Promise<string> {
  const sql = db();
  const [user] = await sql<{ email: string; stripe_cardholder_id: string | null }[]>`
    select email, stripe_cardholder_id from users where id = ${userId}`;
  if (!user) throw new Error('user not found');
  if (user.stripe_cardholder_id) return user.stripe_cardholder_id;

  const local = user.email.split('@')[0] ?? 'molt';
  const firstName = (local.split(/[._-]/)[0] || 'Molt').slice(0, 24);

  const cardholder = await stripe().issuing.cardholders.create(
    {
      type: 'individual',
      name: `${firstName} MoltTest`,
      email: user.email,
      phone_number: '+4915212345678',
      individual: {
        first_name: firstName,
        last_name: 'MoltTest',
      },
      billing: {
        address: {
          line1: 'Teststr. 1',
          city: 'Munich',
          postal_code: '80331',
          country: 'DE',
        },
      },
    },
    // idempotent per user: retries and races produce the same cardholder
    { idempotencyKey: `molt-cardholder-${userId}` },
  );

  // last-write-wins is fine here: same idempotency key -> same cardholder id
  await sql`update users set stripe_cardholder_id = ${cardholder.id} where id = ${userId}`;
  return cardholder.id;
}
