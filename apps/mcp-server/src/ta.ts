/**
 * Thin client for the Tab Authority REST API (OT-025 surface). No retries on
 * writes - idempotency lives in the TA, but a timeout on a mint is an unknown
 * outcome and the caller decides how to surface it.
 */

export interface TaResponse<T = Record<string, unknown>> {
  status: number;
  body: T & { error?: string };
}

export class TaError extends Error {
  constructor(
    message: string,
    readonly cause_detail: string,
  ) {
    super(message);
    this.name = 'TaError';
  }
}

export interface TabIdentity {
  tab_id: string;
  status: string;
  currency: string;
  total_minor: number;
  available_minor: number;
  reserved_minor: number;
  spent_minor: number;
  expires_at: string;
  per_tx_max_minor?: number;
  task_declaration?: string;
}

export class TaClient {
  private tab: TabIdentity | undefined;
  private agentKey: string | undefined;

  constructor(
    private readonly baseUrl: string,
    agentKey: string | undefined,
    private readonly timeoutMs = 20_000,
  ) {
    this.agentKey = agentKey;
  }

  /** Adopt a key handed over at runtime (connect_tab). */
  setKey(key: string): void {
    this.agentKey = key;
    this.tab = undefined;
  }

  get hasKey(): boolean {
    return this.agentKey !== undefined;
  }

  /**
   * The tab this key belongs to. Resolved from the key itself, so no tool
   * ever needs a tab id from the agent, and several configured servers each
   * answer for their own tab. Cached; call with fresh=true for live budget.
   */
  async tabIdentity(fresh = false): Promise<TabIdentity | null> {
    if (this.tab && !fresh) return this.tab;
    const res = await this.call<TabIdentity>('GET', '/v1/tab');
    if (res.status !== 200 || !res.body.tab_id) return null;
    this.tab = res.body;
    return this.tab;
  }

  async call<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<TaResponse<T>> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(this.agentKey ? { authorization: `Bearer ${this.agentKey}` } : {}),
        },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new TaError(`Tab Authority unreachable at ${this.baseUrl}`, detail);
    }
    const parsed = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { status: res.status, body: parsed };
  }
}
