export interface PushOptions {
  baseUrl?: string;
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Shared secret proving this is a legitimate Synapse PWA build (Phase 7e). */
  clientSecret?: string;
}

export class PushError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "PushError";
    this.status = status;
    this.retryable = retryable;
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export async function pushAnalysisPayload(
  payload: import("@synapse/contracts").AnalysisPayload,
  opts: PushOptions = {},
): Promise<void> {
  const baseUrl = (opts.baseUrl ?? "/api").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const maxRetries = opts.maxRetries ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let i = 0; ; i++) {
    const res = await doFetch(`${baseUrl}/analytics/payload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.clientSecret ? { Authorization: `Bearer ${opts.clientSecret}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return;

    const retryable = RETRYABLE.has(res.status);
    if (!retryable || i >= maxRetries) {
      const text = await res.text().catch(() => "");
      throw new PushError(`push failed: ${res.status} ${text.slice(0, 200)}`, res.status, retryable);
    }
    await sleep(500 * 2 ** i);
  }
}
