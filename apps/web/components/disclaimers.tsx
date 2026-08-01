/**
 * The four disclaimers (OT-081), G1-G3 in plain words. One source of truth:
 * rendered prominently on the landing page and as small print in the global
 * footer (which future docs pages inherit). Wording changes happen here and
 * in README.md together.
 */
export function Disclaimers({ compact = false }: { compact?: boolean }) {
  const items = [
    'The hosted beta is test mode only. No real money moves.',
    'Self-hosters operate their own issuer relationship and are responsible for their own compliance.',
    'Molt is technical infrastructure. It never holds funds, never initiates payments, and never performs strong customer authentication.',
    'Nothing here is financial or legal advice.',
  ];
  if (compact) {
    return (
      <footer
        style={{
          maxWidth: 640,
          margin: '4rem auto 2rem',
          padding: '1rem 1rem 0',
          borderTop: '1px solid #eee',
          fontSize: '0.78rem',
          color: '#888',
          fontFamily: 'system-ui',
        }}
      >
        {items.join(' ')}
      </footer>
    );
  }
  return (
    <section>
      <h2 style={{ fontSize: '1.1rem' }}>What this is, and is not</h2>
      <ul>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}
