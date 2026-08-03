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

  // Gmail collapses trailing content that repeats byte-identically across
  // mails ("trimmed content"), which once hid the trigger and the deny
  // guidance: the action leads, and every closing line carries per-mail data.
  const host = mail.merchant.replace(/^https?:\/\//, '');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? 'step-up@localhost',
      to: mail.to,
      subject: `Approve purchase: ${amount} at ${host}`,
      html: [
        `<p>Your agent wants to buy at <strong>${host}</strong> for <strong>${amount}</strong>.</p>`,
        `<p style="margin:16px 0"><a href="${mail.url}" style="background:#0a7d33;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Review and approve or deny</a></p>`,
        `<p>Held because: ${mail.triggers.join('; ')}</p>`,
        `<p>Reason given by the agent: ${mail.reason}</p>`,
        `<p>Approving the ${amount} purchase requires your passkey; the link alone approves nothing. If you did not expect a charge at ${host}, deny it. This request expires 15 minutes after it was created.</p>`,
      ].join('\n'),
      text: [
        `Your agent wants to buy at ${host} for ${amount}.`,
        '',
        `Review and approve or deny: ${mail.url}`,
        '',
        `Held because: ${mail.triggers.join('; ')}`,
        `Reason given by the agent: ${mail.reason}`,
        '',
        `Approving the ${amount} purchase requires your passkey; the link alone approves nothing. If you did not expect a charge at ${host}, deny it. This request expires 15 minutes after it was created.`,
      ].join('\n'),
    }),
  });
  return { sent: res.ok };
}
