"use strict";
// providers/openai.ts
// --------------------
// Provider implementation for the OpenAI Chat Completions API.
//
// API reference: https://platform.openai.com/docs/api-reference/chat
//
// We delegate all the heavy lifting (agentic loop, tool calling, error
// handling) to openai-compatible.ts. This file is a thin configuration
// wrapper that supplies the OpenAI-specific URL and auth header.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpenAIProvider = createOpenAIProvider;
var openai_compatible_js_1 = require("./openai-compatible.js");
function createOpenAIProvider(opts) {
    return (0, openai_compatible_js_1.createOpenAICompatibleProvider)({
        apiUrl: "https://api.openai.com/v1/chat/completions",
        apiKey: opts.apiKey,
        model: opts.model,
        onEvent: opts.onEvent,
    });
}
