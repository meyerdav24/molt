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

export class TaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly agentKey: string | undefined,
    private readonly timeoutMs = 20_000,
  ) {}

  get hasKey(): boolean {
    return this.agentKey !== undefined;
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
