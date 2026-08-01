'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useState } from 'react';
import { MCC_CATEGORIES } from '../../../lib/mcc';

/**
 * The Open Tab ceremony (OT-021). The user sets bounds; submitting triggers a
 * fresh passkey assertion whose challenge is the SHA-256 of exactly these
 * bounds. Target: complete in under 30 seconds of user time.
 */

const TRIGGERS = [
  { key: 'unknown_merchant', label: 'Unknown merchant' },
  { key: 'amount_above_baseline', label: 'Amount above baseline' },
  { key: 'mcc_outside_allowlist', label: 'Category outside allowlist' },
  { key: 'velocity_exceeded', label: 'Too many purchases per hour' },
] as const;

const ACTIONS = ['allow', 'notify', 'require_tap', 'block'] as const;

export default function NewTabPage() {
  const [totalEur, setTotalEur] = useState('400');
  const [perTxEur, setPerTxEur] = useState('150');
  const [days, setDays] = useState('7');
  const [categories, setCategories] = useState<string[]>(['office_electronics']);
  const [denylist, setDenylist] = useState('');
  const [velocity, setVelocity] = useState('10');
  const [task, setTask] = useState('');
  const [policy, setPolicy] = useState<Record<string, string>>({
    unknown_merchant: 'require_tap',
    amount_above_baseline: 'require_tap',
    mcc_outside_allowlist: 'block',
    velocity_exceeded: 'block',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toMinor(eur: string): number {
    return Math.round(Number(eur.replace(',', '.')) * 100);
  }

  function toggleCategory(key: string) {
    setCategories((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  }

  async function openTab() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        total_minor: toMinor(totalEur),
        per_tx_max_minor: toMinor(perTxEur),
        duration_days: Number(days),
        categories,
        merchant_denylist: denylist
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        velocity_per_hour: Number(velocity),
        task_declaration: task,
        step_up_policy: policy,
      };
      const optRes = await fetch('/api/tabs/ceremony/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!optRes.ok) {
        const d = (await optRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `options failed (${optRes.status})`);
      }
      const options = await optRes.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const verRes = await fetch('/api/tabs/ceremony/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(assertion),
      });
      if (!verRes.ok) {
        const d = (await verRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `verify failed (${verRes.status})`);
      }
      window.location.href = '/dashboard';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ceremony failed');
    } finally {
      setBusy(false);
    }
  }

  const row = {
    display: 'block',
    width: '100%',
    padding: '0.5rem',
    boxSizing: 'border-box',
  } as const;
  const label = { display: 'block', margin: '0.9rem 0 0.25rem', fontWeight: 600 } as const;

  return (
    <main
      style={{ maxWidth: 520, margin: '3rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}
    >
      <h1>Open a tab</h1>
      <p>
        Set the limits, then confirm with your fingerprint. The passkey signs exactly these bounds.
      </p>

      <label style={label}>Total budget (EUR)</label>
      <input
        style={row}
        value={totalEur}
        onChange={(e) => setTotalEur(e.target.value)}
        inputMode="decimal"
      />

      <label style={label}>Per-purchase maximum (EUR)</label>
      <input
        style={row}
        value={perTxEur}
        onChange={(e) => setPerTxEur(e.target.value)}
        inputMode="decimal"
      />

      <label style={label}>Valid for (days)</label>
      <input
        style={row}
        value={days}
        onChange={(e) => setDays(e.target.value)}
        inputMode="numeric"
      />

      <label style={label}>Categories</label>
      {MCC_CATEGORIES.map((c) => (
        <label key={c.key} style={{ display: 'block', padding: '0.15rem 0' }}>
          <input
            type="checkbox"
            checked={categories.includes(c.key)}
            onChange={() => toggleCategory(c.key)}
          />{' '}
          {c.label}
        </label>
      ))}

      <label style={label}>Blocked merchants (optional, comma-separated origins)</label>
      <input
        style={row}
        value={denylist}
        onChange={(e) => setDenylist(e.target.value)}
        placeholder="https://example-shop.com"
      />

      <label style={label}>Max purchases per hour</label>
      <input
        style={row}
        value={velocity}
        onChange={(e) => setVelocity(e.target.value)}
        inputMode="numeric"
      />

      <label style={label}>What is the agent allowed to do?</label>
      <textarea
        style={{ ...row, minHeight: 70 }}
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Restock the office: paper towels, printer paper, and a USB-C hub."
      />

      <label style={label}>When something is unusual</label>
      {TRIGGERS.map((t) => (
        <div
          key={t.key}
          style={{ display: 'flex', justifyContent: 'space-between', padding: '0.15rem 0' }}
        >
          <span>{t.label}</span>
          <select
            value={policy[t.key]}
            onChange={(e) => setPolicy((p) => ({ ...p, [t.key]: e.target.value }))}
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      ))}

      <button
        onClick={openTab}
        disabled={busy || !task.trim() || categories.length === 0}
        style={{ width: '100%', padding: '0.7rem', marginTop: '1.2rem', fontWeight: 600 }}
      >
        {busy ? 'Waiting for passkey…' : 'Open tab with fingerprint'}
      </button>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </main>
  );
}
