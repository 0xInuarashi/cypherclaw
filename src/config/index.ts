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
//
// Discord connector variables:
//   DISCORD_BOT_TOKEN      — required to enable the Discord connector
//   DISCORD_COMMANDER_IDS  — comma-separated Discord user IDs allowed to command the agent
//   DISCORD_CHANNEL_IDS    — (optional) comma-separated channel IDs the bot will respond in
//   DISCORD_GUILD_IDS      — (optional) comma-separated guild IDs the bot will operate in

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

// ── Discord connector config ─────────────────────────────────────────────────

// The shape of the Discord connector configuration.
// This is separate from AppConfig because Discord is an optional channel
// overlay — you can run without it, and it doesn't affect the LLM provider.
export type DiscordConfig = {
  // The bot token used to authenticate with the Discord gateway.
  botToken: string;
  // Discord user IDs that the agent treats as authorized commanders.
  // Only messages from these users will be processed.
  commanderIds: Set<string>;
  // If non-empty, the bot only responds in these specific channel IDs.
  // An empty set means "all channels" (within any guild/DM constraints).
  channelIds: Set<string>;
  // If non-empty, the bot only responds inside these guild (server) IDs.
  // An empty set means "any guild" (plus DMs).
  // When both guildIds and channelIds are set, BOTH must match.
  guildIds: Set<string>;
};

// Parse a comma-separated env var into a trimmed, non-empty Set<string>.
// Empty strings and whitespace-only values are filtered out.
function parseIdList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Read and validate Discord config from the environment.
// Returns null if DISCORD_BOT_TOKEN or DISCORD_COMMANDER_IDS is absent,
// meaning the Discord connector should simply not start. This is intentional:
// Discord is an optional add-on — not having it set is not an error.
//
// Throws a clear error only when the values are present but malformed
// (e.g. DISCORD_COMMANDER_IDS is set but empty after parsing).
export function loadDiscordConfig(): DiscordConfig | null {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const rawCommanderIds = process.env.DISCORD_COMMANDER_IDS?.trim();

  // Both token and at least one commander ID are required to activate the connector.
  if (!botToken || !rawCommanderIds) return null;

  const commanderIds = parseIdList(rawCommanderIds);
  if (commanderIds.size === 0) {
    throw new Error(
      "DISCORD_COMMANDER_IDS is set but contains no valid IDs. " +
        "Provide at least one Discord user ID (comma-separated).",
    );
  }

  return {
    botToken,
    commanderIds,
    // These two are optional; an empty Set means "no restriction".
    channelIds: parseIdList(process.env.DISCORD_CHANNEL_IDS),
    guildIds: parseIdList(process.env.DISCORD_GUILD_IDS),
  };
}
