import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Molt',
  description:
    'Delegate bounded spending to an AI agent. It grows a disposable shell for every purchase, wears it once, and sheds it.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
