'use client';

import { useState } from 'react';

/** Hosted-live-mode waitlist (OT-091): email, one question, no tracking. */
export function WaitlistForm() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [email, setEmail] = useState('');
  const [answer, setAnswer] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('busy');
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, answer }),
    }).catch(() => null);
    setState(res?.ok ? 'done' : 'error');
  }

  if (state === 'done') {
    return <p>You are on the list. No newsletter, no tracking; one email when live mode opens.</p>;
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: '0.5rem', maxWidth: 420 }}>
      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ padding: '0.55rem', fontSize: '1rem' }}
      />
      <textarea
        placeholder="Optional: what would your agent buy, and what is that worth to you per month?"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={2}
        maxLength={500}
        style={{ padding: '0.55rem', fontSize: '0.95rem', fontFamily: 'inherit' }}
      />
      <button
        type="submit"
        disabled={state === 'busy'}
        style={{ padding: '0.6rem', fontWeight: 600 }}
      >
        Join the waitlist for hosted live mode
      </button>
      {state === 'error' && <span style={{ color: 'crimson' }}>That did not work; try again.</span>}
    </form>
  );
}
