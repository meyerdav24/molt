'use client';

import { useState } from 'react';

export function KeyButton({ tabId }: { tabId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function rotate() {
    if (
      !window.confirm(
        'Create a new agent key? Any existing key for this tab stops working immediately.',
      )
    )
      return;
    setError(null);
    const res = await fetch(`/api/tabs/${tabId}/keys`, { method: 'POST' });
    if (res.ok) {
      const d = (await res.json()) as { secret: string };
      setSecret(d.secret);
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error ?? `could not create a key (${res.status})`);
    }
  }

  return (
    <span>
      <button onClick={rotate}>Agent key</button>
      {error && <span style={{ color: 'crimson', marginLeft: '0.5rem' }}>{error}</span>}
      {secret && (
        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.6rem 0.8rem',
            border: '1px solid #0a7d33',
            borderRadius: 6,
            background: '#f6fbf7',
          }}
        >
          <div style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>
            <strong>Copy it now.</strong> This key is shown once and never again.
          </div>
          <code
            style={{
              display: 'block',
              wordBreak: 'break-all',
              fontSize: '0.85rem',
              marginBottom: '0.4rem',
            }}
          >
            {secret}
          </code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(secret).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </span>
  );
}
