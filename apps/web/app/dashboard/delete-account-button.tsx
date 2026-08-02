'use client';

import { useState } from 'react';

const CONFIRM = 'delete my account and all its data';

/**
 * GDPR deletion (OT-082): typed confirmation, one request, session ends.
 * The server requires the verbatim sentence, so the prompt shows it exactly.
 */
export function DeleteAccountButton() {
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    const typed = window.prompt(
      `This permanently deletes your tabs, mandates, receipts and passkeys. ` +
        `The event log is kept anonymized. Type exactly:\n\n${CONFIRM}`,
    );
    if (typed === null) return;
    if (typed !== CONFIRM) {
      setError('Confirmation text did not match. Nothing was deleted.');
      return;
    }
    const res = await fetch('/api/auth/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: typed }),
    });
    if (res.ok) {
      window.location.href = '/';
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error ?? `deletion failed (${res.status})`);
    }
  }

  return (
    <span>
      <button onClick={deleteAccount} style={{ color: '#a02020' }}>
        Delete account
      </button>
      {error && <span style={{ color: 'crimson', marginLeft: '0.5rem' }}>{error}</span>}
    </span>
  );
}
