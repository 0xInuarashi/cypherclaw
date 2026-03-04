// providers/index.ts
// -------------------
// Factory that maps an AppConfig to a concrete Provider instance.
//
// This is the single place in the codebase that knows about all three provider
// implementations. Everything else (the agent, the CLI commands) talks to the
// generic `Provider` interface and never imports openai.ts / anthropic.ts /
// openrouter.ts directly.
//
// Adding a new provider later requires only:
//   1. A new file in providers/ implementing the Provider interface.
//   2. A new case in the switch below.
//   3. A new entry in config/index.ts for the key env var and default model.

import type { AppConfig } from "../config/index.js";
import type { Provider } from "./types.js";
import type { DebugLogger } from "../debug/events.js";
import { createOpenAIProvider } from "./openai.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenRouterProvider } from "./openrouter.js";

// Given the loaded app config, instantiate and return the correct provider.
// The model field is always resolved (config guarantees a default), so we cast
// it as a string here rather than threading the optional through every factory.
//
// onEvent — optional debug callback. When provided, the provider will emit
// structured trace events for every LLM request, tool call, and result.
// Pass `createDebugLogger()` here to get human-readable console output.
export function createProvider(config: AppConfig, onEvent?: DebugLogger): Provider {
  const model = config.model!;

  switch (config.provider) {
    case "openai":
      return createOpenAIProvider({ apiKey: config.apiKey, model, onEvent });

    case "anthropic":
      return createAnthropicProvider({ apiKey: config.apiKey, model, onEvent });

    case "openrouter":
      return createOpenRouterProvider({ apiKey: config.apiKey, model, onEvent });

    default:
      // TypeScript's exhaustive check — if a new ProviderName is added to the
      // config but not handled here, this line becomes a compile-time error.
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
