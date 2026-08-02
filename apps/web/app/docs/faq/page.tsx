export const metadata = { title: 'FAQ - Molt' };

/** The predictable hard questions, answered without marketing. */
const QA: [string, React.ReactNode][] = [
  [
    'What happens when the agent is prompt-injected or fully compromised?',
    <>
      It can spend at most one outstanding shell. Every child mandate is capped by its parent on
      every dimension (amount, merchant, category, expiry, velocity), scoped to a single cart hash,
      and dies after one authorization. An injected instruction to buy something else either fails
      the narrowing rule, trips the step-up policy (no approval, no shell), or burns the one shell
      the attacker got, which is the bounded worst case the whole design accepts and states. See the
      threat model in the <a href="/docs/spec">spec</a>.
    </>,
  ],
  [
    'Do merchants allow this? What about bot rules in their terms?',
    <>
      Molt takes identity over stealth, without exceptions. Every automated request carries an RFC
      9421 signature, a Tab-Context header, and a user agent that says what it is. No fingerprint
      spoofing, no CAPTCHA solving, ever. A merchant who blocks automation gets their wish: the
      purchase fails honestly with <code>blocked_by_merchant</code> and the human gets a link
      instead. The bet is that identifiable, bounded agent traffic is something merchants can choose
      to serve, and blocking it stays a working off switch.
    </>,
  ],
  [
    'Why not just use ACP, UCP, or another agentic checkout protocol?',
    <>
      Coverage. Native protocols are the best rung of the ladder and Molt prefers them where they
      exist (x402 detection is live; ACP and UCP probes are wired as stubs until real endpoints
      appear in the wild). But most stores speak none of them, so the ladder continues: a
      deterministic Shopify adapter, then guided browser automation, then handing the human a link.
      Every receipt records which rung executed. The mandate and receipt layer is rail-agnostic on
      purpose: protocols can win later without the guarantees changing.
    </>,
  ],
  [
    'Is this regulated payment processing?',
    <>
      No funds ever flow through Molt. The Tab Authority verifies mandates, scopes credentials, and
      countersigns receipts; issuing and settlement happen on the issuer&apos;s rails (Stripe
      Issuing in test mode). The hosted beta is test-mode only and the app refuses to boot
      otherwise. The passkey ceremony authenticates you to Molt for mandate signing; it is not
      strong customer authentication and Molt never claims otherwise. Self-hosters who go live bring
      their own issuer relationship and their own compliance.
    </>,
  ],
  [
    'Does the agent see my card?',
    <>
      It sees one disposable shell at a time: a single-use test card scoped to one cart, capped at
      the mandate amount, delivered exactly once, and dead after use or a few minutes. Your real
      card never enters the system. The Tab Authority stores Stripe card identifiers only, never
      numbers.
    </>,
  ],
  [
    'Why should I trust the Tab Authority?',
    <>
      You should not have to. Receipts are dual-signed (agent and TA) over canonical JSON and verify
      offline with <code>npx molt verify</code>, so a tampering TA produces documents that fail
      verification. The reference implementation is Apache 2.0 and self-hostable; the spec&apos;s
      threat model treats a malicious TA as an explicit case.
    </>,
  ],
];

export default function FaqPage() {
  return (
    <div>
      <h1>FAQ</h1>
      {QA.map(([q, a]) => (
        <section key={q} style={{ marginBottom: '1.2rem' }}>
          <h2 style={{ fontSize: '1.05rem' }}>{q}</h2>
          <p style={{ color: '#333' }}>{a}</p>
        </section>
      ))}
    </div>
  );
}
