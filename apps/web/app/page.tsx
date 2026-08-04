import { WaitlistForm } from '../components/waitlist-form';

/**
 * Landing page (OT-091). The molt cycle leads (OT-098: the first diagram is
 * grow, wear once, shed around one purchase), then how it works, then the
 * honest non-goals. Two deliberate placeholders until their assets exist:
 * the demo video embed (OT-097) and the pricing link (OT-120 text).
 */

function CycleStep({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div style={{ flex: '1 1 180px', minWidth: 160 }}>
      <div style={{ fontSize: '1.6rem' }}>{n}</div>
      <strong>{title}</strong>
      <p style={{ marginTop: '0.3rem', color: '#555', fontSize: '0.95rem' }}>{text}</p>
    </div>
  );
}

export default function Home() {
  return (
    <main
      style={{ maxWidth: 680, margin: '4rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1 style={{ marginBottom: '0.3rem' }}>Molt</h1>
      <p style={{ fontSize: '1.15rem', marginTop: 0 }}>
        Delegate bounded spending to an AI agent. It never touches your real card: for every
        purchase it grows a disposable <strong>shell</strong>, wears it once, and sheds it.
      </p>
      <p>
        <a href="/docs/quickstart">Self-host in 10 minutes</a> ·{' '}
        <a href="https://github.com/meyerdav24/molt">GitHub</a> · <a href="/docs">Docs</a> ·{' '}
        <a href="/docs/spec">Spec</a> · <a href="/login">Sign in</a>
      </p>

      {/* OT-097: the 90-second demo video embeds here once it exists.
          <section><video ... /></section> */}

      {/* --- the molt cycle (the first diagram, per the vocabulary card) ----- */}
      <section style={{ margin: '2.2rem 0' }}>
        <h2 style={{ fontSize: '1.2rem' }}>One purchase, one shell</h2>
        <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
          <CycleStep
            n="🦞"
            title="Grown"
            text="A shell is a disposable payment credential sized to one cart: one store, one amount, minutes of lifetime. It only exists because your signed limits allow it."
          />
          <CycleStep
            n="🛒"
            title="Worn once"
            text="The agent checks out with it, after the checkout total matched the mandate to the cent. One authorization is all a shell can carry."
          />
          <CycleStep
            n="🍤"
            title="Shed"
            text="Used or not, the shell dies. The agent molts after every purchase. What remains is a dual-signed receipt you can verify offline."
          />
        </div>
      </section>

      {/* --- how it works ------------------------------------------------------ */}
      <section style={{ margin: '2.2rem 0' }}>
        <h2 style={{ fontSize: '1.2rem' }}>How it works</h2>
        <p>
          You open a tab once: a passkey ceremony where your fingerprint signs exact limits, such as
          400 total, 200 per purchase, one week, office supplies only. Every purchase derives a
          child mandate from that tab, and a child can never exceed its parent on any dimension.
          Anything unusual, like an unknown store, is held: you get an email, one tap with your
          passkey approves it, one tap denies it. No approval, no shell.
        </p>
        <p>
          Worst case, a fully compromised agent gets a shell at a store you already use: one capped
          amount, already minutes from death. Somewhere new it gets nothing without your thumb. That
          is the whole security model, and it is <a href="/docs/spec">written down</a>.
        </p>
        <p>
          Merchants need no integration and see a customer that identifies itself honestly: signed
          requests, a truthful user agent, no stealth. Stores that block agents get a clean failure
          and you get the link instead.
        </p>
      </section>

      {/* --- the honest section ------------------------------------------------ */}
      <section style={{ margin: '2.2rem 0' }}>
        <h2 style={{ fontSize: '1.2rem' }}>What Molt deliberately does not do</h2>
        <ul style={{ color: '#444' }}>
          <li>No bot-detection evasion. Blocked means blocked, honestly reported.</li>
          <li>No funds custody and no payment initiation. Issuer rails execute; Molt scopes.</li>
          <li>No strong customer authentication, and no claim to it.</li>
          <li>No crypto custody. Testnet only, keys stay with the agent operator.</li>
          <li>No post-purchase guarantees. Delivery and refunds stay between you and the store.</li>
          <li>No ToS dissolution. Your obligations to merchants are unchanged.</li>
        </ul>
        <p style={{ fontSize: '0.9rem', color: '#666' }}>
          These are design commitments, not roadmap gaps. The full list with reasoning is in the{' '}
          <a href="/docs/spec">spec</a>.
        </p>
      </section>

      {/* --- waitlist ----------------------------------------------------------- */}
      <section style={{ margin: '2.2rem 0' }}>
        <h2 style={{ fontSize: '1.2rem' }}>Hosted live mode</h2>
        <p>
          Today Molt is a test-mode beta: self-host it and everything works with play money. A
          hosted version with a real issuer relationship is waitlisted, pending exactly the
          compliance work the docs describe.
        </p>
        <WaitlistForm />
      </section>

      <p style={{ marginTop: '2.5rem', fontSize: '0.9rem' }}>
        <a href="/pricing" style={{ color: '#666' }}>
          Pricing
        </a>
      </p>
    </main>
  );
}
