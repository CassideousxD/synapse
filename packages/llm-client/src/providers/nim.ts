import { LlmError, type ChatRequest, type ChatResult, type LlmClient } from "../types";
import { resolveModel } from "../routing/model-router";

export interface NimOptions {
  /** Omit when talking to our own proxy, which holds the real key. */
  apiKey?: string;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/** Exponential backoff with up to 25% jitter: ~1s, 2s, 4s, capped at 8s (+jitter). */
export function backoffMs(attempt: number): number {
  const base = Math.min(8000, 1000 * 2 ** attempt);
  return base + Math.random() * base * 0.25;
}

export function createNimClient(opts: NimOptions = {}): LlmClient {
  const baseUrl = (opts.baseUrl ?? "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function attemptOnce(req: ChatRequest): Promise<ChatResult> {
    const model = resolveModel(req.tier);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: req.messages,
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 1024,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LlmError(
          `NIM ${res.status}: ${text.slice(0, 200)}`,
          res.status,
          RETRYABLE_STATUS.has(res.status),
        );
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new LlmError("NIM response had no message content");
      }
      return {
        content,
        model,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
            }
          : undefined,
      };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      // network failure or timeout abort: worth retrying
      throw new LlmError(`Network error: ${(e as Error).message}`, undefined, true);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async chat(req) {
      for (let i = 0; ; i++) {
        try {
          return await attemptOnce(req);
        } catch (e) {
          const err = e as LlmError;
          if (!err.retryable || i >= maxRetries) throw err;
          await sleep(backoffMs(i)); // ~1s, 2s, 4s (+jitter)
        }
      }
    },
  };
}
