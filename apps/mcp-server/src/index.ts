/**
 * Molt MCP server (Epic 4). Phase 0 scaffold — the four tools land in OT-040:
 *
 *   open_tab          — returns the ceremony URL for the human; the agent can
 *                       never self-authorize a tab
 *   resolve_merchant  — classify a merchant URL, return the ladder rung
 *   purchase          — child mandate → scoped card → adapter → receipt
 *   get_receipts      — list dual-signed receipts for a tab
 *
 * Transports: stdio + SSE. MCP SDK is added when OT-040 starts (Phase 3).
 */
export const MCP_TOOL_NAMES = ['open_tab', 'resolve_merchant', 'purchase', 'get_receipts'] as const;

if (import.meta.url === `file://${process.argv[1]}`) {
  console.error('molt-mcp-server: not implemented yet (lands in Phase 3, OT-040)');
  process.exit(1);
}
