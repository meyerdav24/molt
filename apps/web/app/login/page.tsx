'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';

/**
 * Passkey-only auth (OT-020). No passwords anywhere. Deliberately plain —
 * dashboard styling is Epic 7.
 */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: unknown) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `request failed (${res.status})`);
    }
    return res.json();
  }

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const options = await post('/api/auth/register/options', { email });
      const attestation = await startRegistration({ optionsJSON: options });
      await post('/api/auth/register/verify', attestation);
      window.location.href = '/dashboard';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'registration failed');
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const options = await post('/api/auth/login/options');
      const assertion = await startAuthentication({ optionsJSON: options });
      await post('/api/auth/login/verify', assertion);
      window.location.href = '/dashboard';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{ maxWidth: 420, margin: '4rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1>Molt</h1>
      <p>Sign in with a passkey. No passwords.</p>

      <button onClick={login} disabled={busy} style={{ width: '100%', padding: '0.6rem' }}>
        Sign in with passkey
      </button>

      <hr style={{ margin: '1.5rem 0' }} />

      <p>First time here? Create an account:</p>
      <input
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          width: '100%',
          padding: '0.6rem',
          marginBottom: '0.5rem',
          boxSizing: 'border-box',
        }}
      />
      <button
        onClick={register}
        disabled={busy || !email}
        style={{ width: '100%', padding: '0.6rem' }}
      >
        Create passkey
      </button>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </main>
  );
}
