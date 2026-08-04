'use client';

import { useState } from 'react';

/**
 * Agent key creation. The key is shown once - and instead of a bare secret,
 * the panel hands over ready-to-paste MCP configs (Hermes and Claude
 * Desktop) with the key and this Tab Authority's URL already filled in
 * (rehearsal finding: a naked key forces terminal archaeology on newcomers).
 */

const SHIPPING_PLACEHOLDER =
  '{"email":"you@example.com","first_name":"Ada","last_name":"Lovelace","address1":"Teststr. 1","city":"Munich","zip":"80331","country_code":"DE"}';

function hermesYaml(key: string, apiUrl: string): string {
  return `mcp_servers:
  molt:
    command: "node"
    args: ["/path/to/molt/apps/mcp-server/dist/index.js"]
    env:
      MOLT_API_URL: "${apiUrl}"
      MOLT_AGENT_KEY: "${key}"
      MOLT_SHIPPING_PROFILE: '${SHIPPING_PLACEHOLDER}'`;
}

function claudeJson(key: string, apiUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        molt: {
          command: 'node',
          args: ['/path/to/molt/apps/mcp-server/dist/index.js'],
          env: {
            MOLT_API_URL: apiUrl,
            MOLT_AGENT_KEY: key,
            MOLT_SHIPPING_PROFILE: SHIPPING_PLACEHOLDER,
          },
        },
      },
    },
    null,
    2,
  );
}

function connectMessage(key: string): string {
  return `Connect to my Molt tab: call the connect_tab tool with this key: ${key}`;
}

function agentInstall(key: string, apiUrl: string): string {
  return `Add this MCP server to your own configuration (for Hermes: ~/.hermes/config.yaml under mcp_servers), fix the args path to where the molt repo is checked out, then reload your MCP servers and confirm the five molt tools are available:

${hermesYaml(key, apiUrl)}`;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '0.85rem' }}>{label}</strong>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: '0.3rem 0 0',
          padding: '0.5rem 0.6rem',
          background: '#f4f4f4',
          borderRadius: 6,
          fontSize: '0.72rem',
          overflowX: 'auto',
          maxHeight: '9rem',
        }}
      >
        {text}
      </pre>
    </div>
  );
}

export function KeyButton({ tabId }: { tabId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const apiUrl = typeof window !== 'undefined' ? window.location.origin : '';

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
            width: 'min(620px, 94vw)',
            maxHeight: '70vh',
            overflowY: 'auto',
            padding: '0.9rem 1.1rem',
            border: '1px solid #0a7d33',
            borderRadius: 8,
            background: '#f6fbf7',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Agent key created - shown once, never again.</strong>
            <button onClick={() => setSecret(null)}>Done</button>
          </div>
          <p style={{ fontSize: '0.85rem', margin: '0.4rem 0 0', color: '#444' }}>
            Agent already connected to Molt? Paste the first block into the chat. First time on this
            machine? Use one of the setup blocks below. Details:{' '}
            <a href="/docs/mcp" target="_blank">
              /docs/mcp
            </a>
          </p>
          <CopyBlock
            label="Tell your agent (paste into the chat; no config, no restart)"
            text={connectMessage(secret)}
          />
          <CopyBlock
            label="Agent sets itself up (paste into the chat of an agent without Molt)"
            text={agentInstall(secret, apiUrl)}
          />
          <CopyBlock
            label="Hermes Agent (~/.hermes/config.yaml)"
            text={hermesYaml(secret, apiUrl)}
          />
          <CopyBlock
            label="Claude Desktop (claude_desktop_config.json)"
            text={claudeJson(secret, apiUrl)}
          />
          <CopyBlock label="Key only" text={secret} />
        </div>
      )}
    </span>
  );
}
