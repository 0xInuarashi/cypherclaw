// providers/openrouter.ts
// ------------------------
// Provider implementation for OpenRouter.
//
// API reference: https://openrouter.ai/docs/requests
//
// OpenRouter is a unified API gateway that sits in front of many LLM providers
// (OpenAI, Anthropic, Google, Mistral, and hundreds more). Its API is a superset
// of the OpenAI Chat Completions format — the same request/response shape — but
// with a different base URL and API key header.
//
// This means the implementation here is nearly identical to openai.ts. The
// differences are:
//   1. Base URL points to openrouter.ai instead of api.openai.com.
//   2. Two optional but recommended headers: HTTP-Referer and X-Title.
//      OpenRouter uses these to attribute usage on its dashboard and to apply
//      per-app rate limits. They don't affect the response.
//   3. Model names use the "provider/model" format (e.g. "openai/gpt-4o-mini",
//      "anthropic/claude-3-5-haiku", "google/gemini-flash-1.5").
//
// The big benefit of OpenRouter over calling providers directly: one API key
// gives you access to every model, and you can switch models just by changing
// the CYPHERCLAW_MODEL env var — no new account or SDK needed.

import type { Message, Provider } from "./types.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Minimal type covering only the fields we read from the response.
// Identical structure to the OpenAI response.
type OpenRouterResponse = {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
};

export function createOpenRouterProvider(opts: { apiKey: string; model: string }): Provider {
  return {
    async chat(messages: Message[]): Promise<string> {
      const res = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
          // Recommended by OpenRouter for attribution and dashboard grouping.
          "HTTP-Referer": "https://github.com/cypherclaw",
          "X-Title": "CypherClaw",
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenRouter API error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as OpenRouterResponse;

      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error("OpenRouter returned an empty response");
      }

      return content;
    },
  };
}
