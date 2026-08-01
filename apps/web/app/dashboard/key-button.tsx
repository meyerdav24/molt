'use client';

import { useState } from 'react';

export function KeyButton({ tabId }: { tabId: string }) {
  const [secret, setSecret] = useState<string | null>(null);

  async function rotate() {
    if (
      !window.confirm(
        'Create a new agent key? Any existing key for this tab stops working immediately.',
      )
    )
      return;
    const res = await fetch(`/api/tabs/${tabId}/keys`, { method: 'POST' });
    if (res.ok) {
      const d = (await res.json()) as { secret: string };
      setSecret(d.secret);
    }
  }

  return (
    <span>
      <button onClick={rotate}>Agent key</button>
      {secret && (
        <span style={{ display: 'block', fontSize: '0.8rem', marginTop: '0.3rem' }}>
          Copy now, shown once: <code>{secret}</code>
        </span>
      )}
    </span>
  );
}
