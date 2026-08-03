import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Disclaimers } from '../components/disclaimers';

export const metadata: Metadata = {
  metadataBase: new URL('https://moltprotocol.dev'),
  title: 'Molt - delegate bounded spending to an AI agent',
  description:
    'Delegate bounded spending to an AI agent. It grows a disposable shell for every purchase, wears it once, and sheds it.',
  openGraph: {
    title: 'Molt - delegate bounded spending to an AI agent',
    description:
      'Delegate bounded spending to an AI agent. It grows a disposable shell for every purchase, wears it once, and sheds it.',
    url: 'https://moltprotocol.dev',
    siteName: 'Molt',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Molt - delegate bounded spending to an AI agent',
    description:
      'Delegate bounded spending to an AI agent. It grows a disposable shell for every purchase, wears it once, and sheds it.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Disclaimers compact />
      </body>
    </html>
  );
}
