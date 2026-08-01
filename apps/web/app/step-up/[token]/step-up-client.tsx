'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useState } from 'react';

export function StepUpClient(props: {
  token: string;
  merchant: string;
  amount: string;
  reason: string;
  triggers: string[];
  expiresAt: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'approved' | 'denied'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error ?? `failed (${res.status})`);
    }
    return res.json();
  }

  async function approve() {
    setState('busy');
    setError(null);
    try {
      const options = await post('/api/step-up/options', { token: props.token });
      const assertion = await startAuthentication({ optionsJSON: options });
      await post('/api/step-up/approve', { token: props.token, assertion });
      setState('approved');
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : 'approval failed');
    }
  }

  async function deny() {
    setState('busy');
    setError(null);
    try {
      await post('/api/step-up/deny', { token: props.token });
      setState('denied');
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : 'deny failed');
    }
  }

  if (state === 'approved')
    return <p>Approved. Your agent continues with exactly this purchase - nothing more.</p>;
  if (state === 'denied') return <p>Denied. The purchase is cancelled and the budget returned.</p>;

  return (
    <div>
      <p>Your agent wants to buy:</p>
      <p style={{ fontSize: '1.3rem' }}>
        <strong>{props.amount}</strong> at <strong>{props.merchant}</strong>
      </p>
      {props.reason && <p>Reason: {props.reason}</p>}
      {props.triggers.length > 0 && (
        <ul>
          {props.triggers.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <button
        onClick={approve}
        disabled={state === 'busy'}
        style={{ width: '100%', padding: '0.8rem', fontWeight: 600, marginBottom: '0.5rem' }}
      >
        Approve with passkey
      </button>
      <button
        onClick={deny}
        disabled={state === 'busy'}
        style={{ width: '100%', padding: '0.8rem' }}
      >
        Deny
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        Expires {new Date(props.expiresAt).toLocaleTimeString()}. No approval, no shell.
      </p>
    </div>
  );
}
