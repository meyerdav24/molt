/**
 * Step-up email delivery (OT-024). Resend when EMAIL_API_KEY is set;
 * honest console fallback for local development (TODO-HUMAN: Resend
 * account) - the URL is printed so the loop stays testable.
 */

export interface StepUpEmail {
  to: string;
  merchant: string;
  amount_minor: number;
  currency: string;
  reason: string;
  triggers: string[];
  url: string;
}

export async function sendStepUpEmail(mail: StepUpEmail): Promise<{ sent: boolean }> {
  const amount = `${(mail.amount_minor / 100).toFixed(2)} ${mail.currency}`;
  const apiKey = process.env.EMAIL_API_KEY;

  if (!apiKey) {
    console.error(
      `[step-up email fallback] to=${mail.to} merchant=${mail.merchant} amount=${amount}\n` +
        `[step-up email fallback] open: ${mail.url}`,
    );
    return { sent: false };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? 'step-up@localhost',
      to: mail.to,
      subject: `Approve purchase: ${amount} at ${mail.merchant}`,
      html: [
        `<p>Your agent wants to buy at <strong>${mail.merchant}</strong> for <strong>${amount}</strong>.</p>`,
        `<p>Reason: ${mail.reason}</p>`,
        `<p>Held because: ${mail.triggers.join('; ')}</p>`,
        `<p><a href="${mail.url}">Review and approve or deny</a> (expires in 15 minutes).</p>`,
        `<p>Approval requires your passkey. If you did not expect this, deny it.</p>`,
      ].join('\n'),
    }),
  });
  return { sent: res.ok };
}
