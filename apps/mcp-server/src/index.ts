/**
 * Molt MCP server (OT-040): the agent surface of the Tab Authority.
 *
 *   open_tab          — returns the ceremony URL for the human; the agent can
 *                       never self-authorize a tab
 *   resolve_merchant  — classify a merchant URL, return the ladder rung
 *   purchase          — quote → child mandate → scoped card → adapter → receipt
 *   get_receipts      — list dual-signed receipts for a tab
 *
 * Transports: stdio (default) and SSE (--sse [port]).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from 'node:http';
import { resolveMerchant } from '@molt/adapters';
import { z } from 'zod';
import { loadConfig, type MoltConfig } from './config.js';
import { purchase } from './purchase.js';
import { loadOrCreateSigningKey, type AgentSigningKey } from './signing.js';
import { TaClient, TaError } from './ta.js';

export const MCP_TOOL_NAMES = ['open_tab', 'resolve_merchant', 'purchase', 'get_receipts'] as const;

const UUID = z.string().uuid();

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Every failure leaves the agent something actionable, never a stack trace. */
function asToolError(e: unknown) {
  if (e instanceof TaError) {
    return textResult({ error: e.message, detail: e.cause_detail }, true);
  }
  return textResult({ error: e instanceof Error ? e.message : String(e) }, true);
}

function buildServer(cfg: MoltConfig, ta: TaClient, signingKey: AgentSigningKey): McpServer {
  const server = new McpServer({ name: 'molt', version: '0.1.0' });

  server.registerTool(
    'open_tab',
    {
      title: 'Open a tab',
      description:
        'Start opening a spending tab. Returns a ceremony URL that the HUMAN OWNER must open to ' +
        'set the budget, expiry and rules, and sign them with their passkey. You cannot complete ' +
        'this yourself: a tab only exists after the human ceremony. Afterwards the human creates ' +
        'an agent key in the dashboard and configures it as MOLT_AGENT_KEY for this server.',
      inputSchema: {},
    },
    async () => {
      try {
        const res = await ta.call('POST', '/v1/tabs');
        return textResult(res.body);
      } catch (e) {
        return asToolError(e);
      }
    },
  );

  server.registerTool(
    'resolve_merchant',
    {
      title: 'Resolve a merchant',
      description:
        'Classify a merchant URL before buying: detects the platform (shopify / x402 / unknown) ' +
        'and recommends the execution rung (L1 deterministic Shopify checkout, L0 native protocol, ' +
        'L3 hand a link to the human). Call this before purchase to know what to expect.',
      inputSchema: { url: z.string().url() },
    },
    async ({ url }) => {
      try {
        return textResult(await resolveMerchant(url));
      } catch (e) {
        return asToolError(e);
      }
    },
  );

  server.registerTool(
    'purchase',
    {
      title: 'Purchase with a fresh shell',
      description:
        'Buy the given items at a merchant, within the limits of the tab. Molt quotes the real ' +
        'checkout total first (no card involved), then requests a single-use child mandate scoped ' +
        'to exactly that cart, gets a disposable card, checks out, and files a dual-signed receipt. ' +
        'Possible non-purchase outcomes you must handle: step_up_pending (the user must approve via ' +
        'the emailed Tap link; retry later with mandate_id), handoff_l3 (give the deep link to the ' +
        'human), refused (the Tab Authority said no; do not retry the same request), already_purchased ' +
        '(this exact cart was bought before), failed (checkout aborted; the shell was shed, nothing ' +
        'was charged). max_amount_minor is your ceiling in minor units (cents); the actual mandate ' +
        'is minted for the exact quoted total.',
      inputSchema: {
        tab_id: UUID.describe('the tab to buy under'),
        merchant_url: z.string().url().describe('the store, e.g. https://shop.example.com'),
        items: z
          .array(
            z.object({
              variant_id: z.number().int().positive().describe('Shopify variant id'),
              quantity: z.number().int().min(1).max(99),
            }),
          )
          .min(1),
        max_amount_minor: z
          .number()
          .int()
          .positive()
          .describe('refuse if the quoted total exceeds this, in minor units'),
        reason: z
          .string()
          .min(3)
          .max(500)
          .describe('why this purchase serves the task the user declared'),
        mandate_id: UUID.optional().describe(
          'only to resume a purchase that returned step_up_pending',
        ),
      },
    },
    async (input) => {
      if (!ta.hasKey) {
        return textResult(
          {
            error: 'not_configured',
            message:
              'MOLT_AGENT_KEY is not set. Use open_tab, have the human complete the ceremony and create an agent key, then restart this server with the key configured.',
          },
          true,
        );
      }
      try {
        const outcome = await purchase(cfg, ta, signingKey, input);
        const isError = outcome.status === 'refused' || outcome.status === 'failed';
        return textResult(outcome, isError);
      } catch (e) {
        return asToolError(e);
      }
    },
  );

  server.registerTool(
    'get_receipts',
    {
      title: 'List receipts',
      description:
        'List all receipts for a tab: what was bought where, for how much, on which ladder rung ' +
        'and rail, with evidence hashes and the mandate chain. Use it to report spending to the user.',
      inputSchema: { tab_id: UUID },
    },
    async ({ tab_id }) => {
      if (!ta.hasKey) {
        return textResult({ error: 'not_configured', message: 'MOLT_AGENT_KEY is not set.' }, true);
      }
      try {
        const res = await ta.call('GET', `/v1/tabs/${tab_id}/receipts`);
        return textResult(res.body, res.status !== 200);
      } catch (e) {
        return asToolError(e);
      }
    },
  );

  return server;
}

async function main() {
  const cfg = loadConfig();
  const ta = new TaClient(cfg.apiUrl, cfg.agentKey);
  const signingKey = loadOrCreateSigningKey(cfg.signingKeyPath);

  const sseIndex = process.argv.indexOf('--sse');
  if (sseIndex >= 0) {
    const port = Number(process.argv[sseIndex + 1] ?? 3939);
    const transports = new Map<string, SSEServerTransport>();
    const http = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/sse') {
        // one McpServer instance per session: sessions must not share state
        const transport = new SSEServerTransport('/messages', res);
        transports.set(transport.sessionId, transport);
        res.on('close', () => transports.delete(transport.sessionId));
        void buildServer(cfg, ta, signingKey).connect(transport);
      } else if (req.method === 'POST' && url.pathname === '/messages') {
        const transport = transports.get(url.searchParams.get('sessionId') ?? '');
        if (!transport) {
          res.writeHead(400).end('unknown session');
          return;
        }
        void transport.handlePostMessage(req, res);
      } else {
        res.writeHead(404).end();
      }
    });
    http.listen(port, () => {
      console.error(`molt-mcp-server: SSE on http://localhost:${port}/sse`);
    });
    return;
  }

  await buildServer(cfg, ta, signingKey).connect(new StdioServerTransport());
  console.error('molt-mcp-server: stdio transport connected');
}

main().catch((e) => {
  console.error(`molt-mcp-server: fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
