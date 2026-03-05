"use strict";
// config/index.ts
// ----------------
// Reads application configuration from environment variables.
//
// We use environment variables (loaded from a .env file via dotenv) rather than
// a JSON/YAML config file for two reasons:
//   1. API keys must never be committed to source control. Env vars are the
//      standard, widely-understood way to keep secrets out of code.
//   2. They're easy to override per-session without editing files, which is
//      convenient when switching between providers for testing.
//
// Variable reference:
//   CYPHERCLAW_PROVIDER    — which LLM provider to use: openai | anthropic | openrouter
//   CYPHERCLAW_MODEL       — (optional) model name; falls back to a sensible
//                            default per provider if not set
//   CYPHERCLAW_SYSTEM_PROMPT — (optional) default system prompt for the agent
//   OPENAI_API_KEY         — required when provider is "openai"
//   ANTHROPIC_API_KEY      — required when provider is "anthropic"
//   OPENROUTER_API_KEY     — required when provider is "openrouter"
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
// Sensible default models for each provider.
// These are capable but cost-efficient choices — easy to swap out.
var DEFAULT_MODELS = {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-haiku-20241022",
    openrouter: "openai/gpt-4o-mini",
};
// The env var name that holds the API key for each provider.
var API_KEY_ENV = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
};
// Read and validate config from the environment. Throws a clear, human-readable
// error if required variables are missing so the user knows exactly what to fix.
function loadConfig() {
    var _a, _b;
    var rawProvider = (_a = process.env.CYPHERCLAW_PROVIDER) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (!rawProvider) {
        throw new Error("Missing CYPHERCLAW_PROVIDER. Set it to one of: openai, anthropic, openrouter");
    }
    var validProviders = ["openai", "anthropic", "openrouter"];
    if (!validProviders.includes(rawProvider)) {
        throw new Error("Unknown provider \"".concat(rawProvider, "\". Must be one of: ").concat(validProviders.join(", ")));
    }
    var provider = rawProvider;
    // Look up the API key for this provider.
    var keyEnvName = API_KEY_ENV[provider];
    var apiKey = process.env[keyEnvName];
    if (!apiKey) {
        throw new Error("Missing ".concat(keyEnvName, " \u2014 required when using provider \"").concat(provider, "\""));
    }
    // Allow an explicit model override, otherwise fall back to the provider default.
    var model = (_b = process.env.CYPHERCLAW_MODEL) !== null && _b !== void 0 ? _b : DEFAULT_MODELS[provider];
    return {
        provider: provider,
        model: model,
        apiKey: apiKey,
        systemPrompt: process.env.CYPHERCLAW_SYSTEM_PROMPT,
    };
}
