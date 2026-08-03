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
        // Fixed panel, not inline: this component also lives inside a narrow
        // table cell, where a 60-character secret has nowhere to wrap.
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: '1.5rem',
            transform: 'translateX(-50%)',
            zIndex: 50,
            maxWidth: 'min(560px, 92vw)',
            padding: '0.8rem 1rem',
            border: '1px solid #0a7d33',
            borderRadius: 8,
            background: '#f6fbf7',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            textAlign: 'left',
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
          </button>{' '}
          <button onClick={() => setSecret(null)}>Done</button>
        </div>
      )}
    </span>
  );
}
