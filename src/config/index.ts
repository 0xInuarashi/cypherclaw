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

// The set of supported provider identifiers.
export type ProviderName = "openai" | "anthropic" | "openrouter";

// The shape of the config object used throughout the app.
export type AppConfig = {
  provider: ProviderName;
  // The model to use. If not explicitly set, each provider picks its own default.
  model?: string;
  apiKey: string;
  systemPrompt?: string;
};

// Sensible default models for each provider.
// These are capable but cost-efficient choices — easy to swap out.
const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  openrouter: "openai/gpt-4o-mini",
};

// The env var name that holds the API key for each provider.
const API_KEY_ENV: Record<ProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

// Read and validate config from the environment. Throws a clear, human-readable
// error if required variables are missing so the user knows exactly what to fix.
export function loadConfig(): AppConfig {
  const rawProvider = process.env.CYPHERCLAW_PROVIDER?.toLowerCase();

  if (!rawProvider) {
    throw new Error(
      "Missing CYPHERCLAW_PROVIDER. Set it to one of: openai, anthropic, openrouter",
    );
  }

  const validProviders: ProviderName[] = ["openai", "anthropic", "openrouter"];
  if (!validProviders.includes(rawProvider as ProviderName)) {
    throw new Error(
      `Unknown provider "${rawProvider}". Must be one of: ${validProviders.join(", ")}`,
    );
  }

  const provider = rawProvider as ProviderName;

  // Look up the API key for this provider.
  const keyEnvName = API_KEY_ENV[provider];
  const apiKey = process.env[keyEnvName];
  if (!apiKey) {
    throw new Error(`Missing ${keyEnvName} — required when using provider "${provider}"`);
  }

  // Allow an explicit model override, otherwise fall back to the provider default.
  const model = process.env.CYPHERCLAW_MODEL ?? DEFAULT_MODELS[provider];

  return {
    provider,
    model,
    apiKey,
    systemPrompt: process.env.CYPHERCLAW_SYSTEM_PROMPT,
  };
}
