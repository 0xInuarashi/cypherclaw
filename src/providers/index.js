"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProvider = createProvider;
var openai_js_1 = require("./openai.js");
var anthropic_js_1 = require("./anthropic.js");
var openrouter_js_1 = require("./openrouter.js");
// Given the loaded app config, instantiate and return the correct provider.
// The model field is always resolved (config guarantees a default), so we cast
// it as a string here rather than threading the optional through every factory.
//
// onEvent — optional debug callback. When provided, the provider will emit
// structured trace events for every LLM request, tool call, and result.
// Pass `createDebugLogger()` here to get human-readable console output.
function createProvider(config, onEvent) {
    var model = config.model;
    switch (config.provider) {
        case "openai":
            return (0, openai_js_1.createOpenAIProvider)({ apiKey: config.apiKey, model: model, onEvent: onEvent });
        case "anthropic":
            return (0, anthropic_js_1.createAnthropicProvider)({ apiKey: config.apiKey, model: model, onEvent: onEvent });
        case "openrouter":
            return (0, openrouter_js_1.createOpenRouterProvider)({ apiKey: config.apiKey, model: model, onEvent: onEvent });
        default:
            // TypeScript's exhaustive check — if a new ProviderName is added to the
            // config but not handled here, this line becomes a compile-time error.
            throw new Error("Unknown provider: ".concat(config.provider));
    }
}
