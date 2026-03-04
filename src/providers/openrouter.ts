// providers/openrouter.ts
// ------------------------
// Provider implementation for OpenRouter.
//
// API reference: https://openrouter.ai/docs/requests
//
// OpenRouter's API is a superset of the OpenAI Chat Completions format, so we
// delegate to openai-compatible.ts just like the OpenAI provider. The only
// differences are:
//   1. Base URL points to openrouter.ai.
//   2. Two optional but recommended headers that OpenRouter uses for
//      attribution and per-app rate limiting on its dashboard.
//   3. Model names use the "provider/model" slug format
//      (e.g. "openai/gpt-4o-mini", "anthropic/claude-3-5-haiku").
//
// The big advantage of OpenRouter: one API key gives you access to every
// major model. You can switch between OpenAI, Anthropic, Google, and others
// just by changing CYPHERCLAW_MODEL — no new account needed.

import type { Message, Provider } from "./types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { DebugLogger } from "../debug/events.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";

export function createOpenRouterProvider(opts: { apiKey: string; model: string; onEvent?: DebugLogger }): Provider {
  return createOpenAICompatibleProvider({
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: opts.apiKey,
    model: opts.model,
    onEvent: opts.onEvent,
    // Recommended by OpenRouter for attribution and dashboard grouping.
    extraHeaders: {
      "HTTP-Referer": "https://github.com/cypherclaw",
      "X-Title": "CypherClaw",
    },
  });
}

export type { Message, Provider, ToolDefinition };
