// cli/program/register.discord.ts
// --------------------------------
// Registers the `cypherclaw discord` command.
//
// This command starts the Discord connector as a foreground process. It wires
// together the same building blocks as `cypherclaw chat` but routes messages
// through Discord instead of the terminal:
//   1. Config (src/config/index.ts)       — reads LLM provider + Discord env vars.
//   2. Tools  (src/tools/index.ts)        — capabilities exposed to the LLM.
//   3. Agent  (src/agent/index.ts)        — maintains per-user history, calls provider.
//   4. Discord channel                    — event-driven bot that relays messages.
//
// Authorization model:
//   Only Discord users whose IDs appear in DISCORD_COMMANDER_IDS receive
//   responses. Optionally, you can restrict to specific guilds and/or channels
//   via DISCORD_GUILD_IDS and DISCORD_CHANNEL_IDS. All three are read from the
//   .env file; see .env.example for the full variable reference.
//
// Per-user agents:
//   Each commander gets their own independent agent instance with its own
//   conversation history. Sessions are persisted under the name
//   "discord-<userId>" using the same JSONL system as `cypherclaw chat --session`.
//   When the bot restarts, each commander's last N turns are reloaded so the
//   conversation context survives restarts.
//
// Flags:
//   --system / -s         Override the system prompt from the command line.
//   --no-tools            Disable tool calling (plain chat, no shell/file access).
//   --debug               Print high-level agentic loop traces.
//   --raw                 Print raw JSON bodies sent to/from the API.
//   --history-limit <n>   Max turns to load per user from their saved session (default: 50).
//
// The process runs indefinitely until Ctrl+C (SIGINT) or SIGTERM is received,
// at which point the bot gracefully disconnects from Discord's gateway.

import process from "node:process";
import type { Command } from "commander";

export function registerDiscordCommand(program: Command): void {
  program
    .command("discord")
    .description("Start the Discord bot connector (requires DISCORD_BOT_TOKEN + DISCORD_COMMANDER_IDS in .env)")
    .option("-s, --system <prompt>", "Custom system prompt for the agent")
    .option("--no-tools", "Disable tool calling (plain chat, no shell/file access)")
    .option("--debug", "Print high-level agentic loop traces (rounds, tool calls, replies)")
    .option("--raw", "Print raw JSON request/response bodies exchanged with the API")
    .option(
      "--history-limit <n>",
      "Max turns to load per user from their saved session (default: 50)",
      "50",
    )
    .action(async (opts: {
      system?: string;
      tools: boolean;
      debug?: boolean;
      raw?: boolean;
      historyLimit: string;
    }) => {
      // Load dotenv before reading any config so .env values are available.
      const { default: dotenv } = await import("dotenv");
      dotenv.config();

      // Load and validate Discord config. If the required env vars aren't set,
      // this returns null and we exit with a helpful message rather than crashing.
      const { loadDiscordConfig, loadConfig } = await import("../../config/index.js");
      const discordConfig = loadDiscordConfig();
      if (!discordConfig) {
        console.error(
          "[cypherclaw] Discord connector is not configured.\n" +
            "  Set DISCORD_BOT_TOKEN and DISCORD_COMMANDER_IDS in your .env file.\n" +
            "  See .env.example for the full variable reference.",
        );
        process.exitCode = 1;
        return;
      }

      // Build the debug/raw event logger from the active flags (same as `chat`).
      let onEvent;
      if (opts.debug || opts.raw) {
        const { createDebugLogger, createRawLogger, combineLoggers } =
          await import("../../debug/logger.js");
        const loggers = [
          ...(opts.debug ? [createDebugLogger()] : []),
          ...(opts.raw   ? [createRawLogger()]   : []),
        ];
        onEvent = combineLoggers(...loggers);
      }

      // Load the LLM provider config and instantiate the provider.
      const config = loadConfig();
      const { createProvider } = await import("../../providers/index.js");
      const provider = createProvider(config, onEvent);

      // Load the default tool set (unless --no-tools was passed).
      // Note: --tool-confirm is not supported in the Discord channel because
      // there's no interactive stdin to ask y/n on. Tool calls run automatically.
      let agentTools: import("../../tools/types.js").ToolDefinition[] | undefined;
      if (opts.tools) {
        const { defaultTools } = await import("../../tools/index.js");
        agentTools = defaultTools;
      }

      const historyLimit = Math.max(1, parseInt(opts.historyLimit, 10) || 50);

      // Import session utilities once, reused inside the per-user factory below.
      const { loadSession, appendToSession } = await import("../../sessions/index.js");
      const { createAgent } = await import("../../agent/index.js");
      const systemPrompt = opts.system ?? process.env.CYPHERCLAW_SYSTEM_PROMPT;

      // Factory: create (and session-restore) a fresh agent for each commander.
      // Called once per unique userId the first time they send a message.
      // The session name "discord-<userId>" is stable across restarts, so each
      // commander's conversation history survives bot restarts.
      const createAgentForUser = async (userId: string) => {
        // Each user's session is keyed by their Discord user ID so conversations
        // are isolated — one user's context never bleeds into another's.
        const sessionName = `discord-${userId}`;
        let initialHistory;
        let savedMessageCount = 0;

        const loaded = await loadSession(sessionName, historyLimit);
        if (loaded && loaded.length > 0) {
          initialHistory = loaded;
          savedMessageCount = loaded.length;
          console.log(
            `[cypherclaw] Resumed session for user ${userId} ` +
              `(${loaded.length} messages loaded)`,
          );
        } else {
          console.log(`[cypherclaw] New session started for user ${userId} (${sessionName})`);
        }

        // Append new messages to the session file after every completed turn.
        const onAfterTurn = async (history: import("../../providers/types.js").Message[]) => {
          const newMessages = history.slice(savedMessageCount);
          if (newMessages.length > 0) {
            await appendToSession(sessionName, newMessages);
            savedMessageCount = history.length;
          }
        };

        return createAgent({
          systemPrompt,
          provider,
          tools: agentTools,
          initialHistory,
          onAfterTurn,
        });
      };

      // Start the Discord bot. This connects to Discord's gateway and returns
      // once the bot is ready. Message handling is then fully event-driven.
      const { runDiscordChannel } = await import("../../channels/discord/index.js");
      const { stop } = await runDiscordChannel({ config: discordConfig, createAgentForUser });

      // Gracefully disconnect from Discord on SIGINT (Ctrl+C) or SIGTERM.
      // Without this the process would hang until Node's event loop drains.
      const shutdown = async () => {
        console.log("\n[cypherclaw] Shutting down Discord connector...");
        await stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      console.log("[cypherclaw] Discord connector running. Press Ctrl+C to stop.");
    });
}
