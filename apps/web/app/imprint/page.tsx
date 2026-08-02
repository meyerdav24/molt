/**
 * Impressum (§5 DDG). The address placeholder is filled by the site
 * operator before launch traffic arrives; see TODO-HUMAN. Reviewed together
 * with the disclaimers by the lawyer-adjacent reader.
 */
export const metadata = { title: 'Imprint - Molt' };

export default function ImprintPage() {
  return (
    <main
      style={{ maxWidth: 640, margin: '4rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1>Imprint</h1>
      <p>Information according to §5 DDG (German Digital Services Act):</p>
      <p>
        David Meyer
        <br />
        {/* TODO-HUMAN: ladungsfaehige Anschrift eintragen (Strasse, PLZ, Ort) */}
        [address pending]
        <br />
        Munich, Germany
      </p>
      <p>
        Contact: <code>privacy@moltprotocol.dev</code>
      </p>
      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Molt is a test-mode open-source project. No real money moves through this site. See the{' '}
        <a href="/privacy">privacy policy</a> and the disclaimers in the footer.
      </p>
    </main>
  );
}
