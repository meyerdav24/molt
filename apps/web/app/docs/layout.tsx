import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Docs shell (OT-090): a sidebar and a content column, nothing framework-y.
 * Wraps on small screens; the sidebar becomes a top nav.
 */
const NAV: [string, string][] = [
  ['/docs', 'Overview'],
  ['/docs/quickstart', 'Quickstart'],
  ['/docs/mcp', 'Claude Desktop / MCP'],
  ['/docs/wallet', 'Agent wallet (x402)'],
  ['/docs/api', 'API reference'],
  ['/docs/spec', 'Protocol spec'],
  ['/docs/faq', 'FAQ'],
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '2rem',
        maxWidth: 900,
        margin: '2.5rem auto',
        padding: '0 1rem',
        fontFamily: 'system-ui',
        alignItems: 'flex-start',
      }}
    >
      <nav style={{ minWidth: 170, flex: '0 0 auto' }}>
        <p style={{ fontWeight: 700, marginTop: 0 }}>
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            Molt
          </Link>{' '}
          docs
        </p>
        <ul style={{ listStyle: 'none', padding: 0, lineHeight: 1.9 }}>
          {NAV.map(([href, label]) => (
            <li key={href}>
              <Link href={href}>{label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <article style={{ flex: '1 1 480px', minWidth: 0, lineHeight: 1.55 }}>{children}</article>
    </div>
  );
}
