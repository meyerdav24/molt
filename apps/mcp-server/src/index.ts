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
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { resolveMerchant } from '@molt/adapters';
import { z } from 'zod';
import { appendAudit } from './audit.js';
import { loadConfig, type MoltConfig } from './config.js';
import { purchase } from './purchase.js';
import { checkRate } from './ratelimit.js';
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

/** Merchants live on the web: http(s) only, no file:, javascript:, etc. */
function assertHttpUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`unsupported URL scheme '${url.protocol}' - merchant URLs must be http(s)`);
  }
  return raw;
}

type ToolResult = ReturnType<typeof textResult>;

/** One-word outcome for the audit line, never full payloads. */
function summarize(result: ToolResult): string {
  try {
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      status?: string;
      error?: string;
    };
    return parsed.status ?? parsed.error ?? (result.isError ? 'error' : 'ok');
  } catch {
    return result.isError ? 'error' : 'ok';
  }
}

/**
 * OT-041 wrapper around every tool: per-key rate limit in, audit line out,
 * and no exception ever escapes as a crash.
 */
function guarded<A>(
  cfg: MoltConfig,
  rateKey: string,
  tool: string,
  handler: (args: A) => Promise<ToolResult>,
): (args: A) => Promise<ToolResult> {
  return async (args) => {
    const started = Date.now();
    let result: ToolResult;
    const wait = checkRate(rateKey, tool);
    if (wait !== null) {
      result = textResult(
        {
          error: 'rate_limited',
          retry_in_ms: wait,
          message: `too many ${tool} calls; wait ${Math.ceil(wait / 1000)}s and try again`,
        },
        true,
      );
    } else {
      try {
        result = await handler(args);
      } catch (e) {
        result = asToolError(e);
      }
    }
    appendAudit(cfg.auditLogPath, {
      ts: new Date(started).toISOString(),
      tool,
      args,
      outcome: summarize(result),
      duration_ms: Date.now() - started,
    });
    return result;
  };
}

function buildServer(cfg: MoltConfig, ta: TaClient, signingKey: AgentSigningKey): McpServer {
  const server = new McpServer({ name: 'molt', version: '0.1.0' });
  // rate-limit bucket per agent key (hashed - the key itself stays out of memory dumps)
  const rateKey = cfg.agentKey
    ? createHash('sha256').update(cfg.agentKey).digest('hex').slice(0, 16)
    : 'anonymous';

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
    guarded(cfg, rateKey, 'open_tab', async () => {
      const res = await ta.call('POST', '/v1/tabs');
      return textResult(res.body);
    }),
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
    guarded(cfg, rateKey, 'resolve_merchant', async ({ url }: { url: string }) => {
      return textResult(await resolveMerchant(assertHttpUrl(url)));
    }),
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
          .min(1)
          .max(20),
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
    guarded(cfg, rateKey, 'purchase', async (input: Parameters<typeof purchase>[3]) => {
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
      assertHttpUrl(input.merchant_url);
      const outcome = await purchase(cfg, ta, signingKey, input);
      const isError = outcome.status === 'refused' || outcome.status === 'failed';
      return textResult(outcome, isError);
    }),
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
    guarded(cfg, rateKey, 'get_receipts', async ({ tab_id }: { tab_id: string }) => {
      if (!ta.hasKey) {
        return textResult({ error: 'not_configured', message: 'MOLT_AGENT_KEY is not set.' }, true);
      }
      const res = await ta.call('GET', `/v1/tabs/${tab_id}/receipts`);
      return textResult(res.body, res.status !== 200);
    }),
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
