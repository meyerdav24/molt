/**
 * Pricing (OT-120): exactly three lines, no feature matrix. The free-forever
 * rule appears verbatim. Self-serve Stripe Billing wires up next; until
 * then upgrading is one email.
 */
export const metadata = { title: 'Pricing - Molt' };

export default function PricingPage() {
  return (
    <main
      style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1>Pricing</h1>
      <p style={{ fontSize: '1.05rem' }}>
        Everything in the repo is free forever. You pay us to run it, integrate it, or come first in
        line.
      </p>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <strong>Free</strong>: self-host everything, 1 hosted tab, community support.
        </li>
        <li>
          <strong>Hosted Dev</strong> (29 EUR/month): unlimited test-mode tabs, higher API rate
          limits, retained receipt history, priority adapter queue, email support.
        </li>
        <li>
          <strong>Design Partner</strong>: <a href="mailto:privacy@moltprotocol.dev">talk to us</a>.
        </li>
      </ul>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Self-serve upgrade is being wired up; until then, upgrades are one email to{' '}
        <code>privacy@moltprotocol.dev</code>. The hosted service operates in test mode; no plan
        moves real money.
      </p>
    </main>
  );
}
