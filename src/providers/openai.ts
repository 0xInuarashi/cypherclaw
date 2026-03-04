// providers/openai.ts
// --------------------
// Provider implementation for the OpenAI Chat Completions API.
//
// API reference: https://platform.openai.com/docs/api-reference/chat
//
// We delegate all the heavy lifting (agentic loop, tool calling, error
// handling) to openai-compatible.ts. This file is a thin configuration
// wrapper that supplies the OpenAI-specific URL and auth header.

import type { Message, Provider } from "./types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { DebugLogger } from "../debug/events.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";

export function createOpenAIProvider(opts: { apiKey: string; model: string; onEvent?: DebugLogger }): Provider {
  return createOpenAICompatibleProvider({
    apiUrl: "https://api.openai.com/v1/chat/completions",
    apiKey: opts.apiKey,
    model: opts.model,
    onEvent: opts.onEvent,
  });
}

// Re-export the types so callers don't need an extra import.
export type { Message, Provider, ToolDefinition };
