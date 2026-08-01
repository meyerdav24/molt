'use client';

export function RevokeButton({ tabId }: { tabId: string }) {
  async function revoke() {
    if (!window.confirm('Revoke this tab? The agent loses all remaining spending authority.'))
      return;
    const res = await fetch(`/api/tabs/${tabId}/revoke`, { method: 'POST' });
    if (res.ok) window.location.reload();
  }
  return <button onClick={revoke}>Revoke</button>;
}
