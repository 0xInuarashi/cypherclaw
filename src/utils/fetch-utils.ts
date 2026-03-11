import type { DebugLogger } from "../debug/events.js";

export const MAX_LLM_RETRIES = 20;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 30_000;

export async function fetchWithRetry<T>(fn: () => Promise<T>, emit: DebugLogger, signal?: AbortSignal): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    signal?.throwIfAborted();
    if (attempt > 0) {
      const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
      emit({ type: "llm_raw_request", body: { _retry: attempt, _delayMs: delay } });
      await new Promise<void>((res, rej) => {
        const timer = setTimeout(res, delay);
        signal?.addEventListener("abort", () => { clearTimeout(timer); rej(signal.reason); }, { once: true });
      });
    }
    try {
      return await fn();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastError = err;
    }
  }
  throw lastError;
}
