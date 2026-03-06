// cli/program/register.chat.ts
// -----------------------------
// Registers the `cypherclaw chat` command.
//
// This command wires together the four main building blocks:
//   1. Config (src/config/index.ts)            — reads env vars for provider / key / model.
//   2. Tools  (src/tools/index.ts)             — the capabilities we expose to the LLM.
//   3. The agent  (src/agent/index.ts)         — maintains history, calls provider + tools.
//   4. The terminal channel                    — readline prompt loop for input/output.
//
// The command itself is intentionally thin. It loads config, instantiates the
// provider and agent (with tools), then hands control to the channel. When the
// user types "exit" or presses Ctrl+C, the channel closes and this returns.
//
// Flags:
//   --system / -s      Override the system prompt from the command line.
//   --no-tools         Disable tool calling (plain chat mode, no shell access).
//   --no-provider      Skip LLM config entirely and fall back to the echo stub.
//   --debug            Print high-level agentic loop traces (rounds, tool calls, replies).
//   --raw              Print the exact raw JSON bodies sent to and received from the API.
//   --tool-confirm     Require y/n approval before every tool call executes.
//   --session <name>   Save/resume a named conversation session.
//                        • If the session file exists, history is loaded and the
//                          conversation resumes from where it left off.
//                        • If not, a new session file is created on the first turn.
//                        • After every turn, new messages are appended to the file.
//   --history-limit <n> When resuming a session, only load the last N turns into
//                        context (default: 50). Each turn = 1 user + 1 assistant
//                        message. Older messages stay on disk but are not sent to
//                        the model, keeping token usage bounded.
//
// Flags can be freely combined, e.g. --session my-proj --debug --tool-confirm.
//
// readline sharing (--tool-confirm):
//   When --tool-confirm is active we create ONE readline interface up front and
//   share it between the confirm wrapper and the terminal channel. This is
//   critical: if two readline interfaces both listen on stdin simultaneously,
//   they race for keystrokes, causing double-reads, mangled output, and abrupt
//   session termination. A single shared instance avoids all of that.

import readline from "node:readline";
import process from "node:process";
import { randomUUID } from "node:crypto";
import type { Command } from "commander";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start an interactive chat session in the terminal")
    .option("-s, --system <prompt>", "Custom system prompt for the agent")
    .option("--no-tools", "Disable tool calling (plain chat, no shell/file access)")
    .option("--no-provider", "Use echo stub instead of a real LLM provider")
    .option("--debug", "Print high-level agentic loop traces (rounds, tool calls, replies)")
    .option("--raw", "Print raw JSON request/response bodies exchanged with the API")
    .option("--tool-confirm", "Require y/n approval before every tool call executes")
    .option("--session <name>", "Save/resume a named conversation session")
    .option(
      "--history-limit <n>",
      "Max turns to load from a saved session (default: 50)",
      "50",
    )
    .action(async (opts: {
      system?: string;
      provider: boolean;
      tools: boolean;
      debug?: boolean;
      raw?: boolean;
      toolConfirm?: boolean;
      session?: string;
      historyLimit: string;
    }) => {
      const { createAgent } = await import("../../agent/index.js");
      const { runTerminalChannel } = await import("../../channels/terminal/index.js");

      // Build a combined event logger from whichever flags are active.
      // If neither --debug nor --raw is set, onEvent stays undefined and the
      // provider runs silently.
      let onEvent;
      if (opts.debug || opts.raw) {
        const { createDebugLogger, createRawLogger, combineLoggers } = await import("../../debug/logger.js");
        const loggers = [
          ...(opts.debug ? [createDebugLogger()] : []),
          ...(opts.raw   ? [createRawLogger()]   : []),
        ];
        onEvent = combineLoggers(...loggers);
      }

      // When --tool-confirm is active, create the shared readline interface
      // here so both the confirm wrapper and the terminal channel use the same
      // instance. When it's not active, the terminal channel creates its own.
      const sharedRl = opts.toolConfirm
        ? readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
          })
        : undefined;

      // ── Session: resolve name and load existing history ─────────────────────
      // Every chat gets a session — either the user-provided name or a fresh
      // UUID. This means all conversations are persisted automatically.
      // We track `savedMessageCount` so onAfterTurn can cheaply compute which
      // messages are new (history.slice(savedMessageCount)) without diffing.
      const sessionName = opts.session ?? randomUUID();
      let initialHistory;
      let savedMessageCount = 0;
      const historyLimit = Math.max(1, parseInt(opts.historyLimit, 10) || 50);

      {
        const { loadSession } = await import("../../sessions/index.js");
        const loaded = await loadSession(sessionName, historyLimit);
        if (loaded && loaded.length > 0) {
          initialHistory = loaded;
          savedMessageCount = loaded.length;
          console.log(
            `[cypherclaw] Resumed session "${sessionName}" ` +
              `(${loaded.length} messages loaded, limit: ${historyLimit} turns)\n`,
          );
        } else {
          console.log(`[cypherclaw] Session: ${sessionName}\n`);
        }
      }

      // `opts.provider` is true by default; false when --no-provider is passed.
      let agentProvider;
      if (opts.provider) {
        const { loadConfig } = await import("../../config/index.js");
        const { createProvider } = await import("../../providers/index.js");
        const config = loadConfig();
        agentProvider = createProvider(config, onEvent);
      }

      // `opts.tools` is true by default; false when --no-tools is passed.
      // We only load tools when a real provider is active — the echo stub
      // doesn't make API calls so tools would never be triggered anyway.
      let agentTools;
      if (opts.tools && agentProvider) {
        const { defaultTools } = await import("../../tools/index.js");

        // If --tool-confirm is active, wrap every tool so it asks y/n before
        // executing. The shared readline instance is passed so confirmation
        // prompts don't conflict with the main chat readline.
        if (opts.toolConfirm && sharedRl) {
          const { wrapWithConfirm } = await import("../../tools/utils/confirm.js");
          agentTools = wrapWithConfirm(defaultTools, sharedRl);
        } else {
          agentTools = defaultTools;
        }
      }

      // ── Session: append new messages and token usage after every turn ─────────
      // onAfterTurn fires with the full history and token usage for the turn.
      // We slice from savedMessageCount to get only the new messages, append
      // them, then advance the counter so the next turn's slice is correct.
      // Token usage is always recorded (even zero usage from the echo stub).
      const { appendToSession, appendSessionTokens } = await import("../../sessions/index.js");
      const onAfterTurn = async (
        history: import("../../providers/types.js").Message[],
        usage: import("../../providers/types.js").TokenUsage,
      ) => {
        const newMessages = history.slice(savedMessageCount);
        if (newMessages.length > 0) {
          await appendToSession(sessionName, newMessages);
          savedMessageCount = history.length;
        }
        await appendSessionTokens(sessionName, usage);
      };

      const { DEFAULT_SYSTEM_PROMPT } = await import("../../agent/system-prompt.js");

      const resolvedSystemPrompt = (opts.system ?? process.env.CYPHERCLAW_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT)
        .replace(/\{\{SESSION_ID\}\}/g, sessionName);

      const agent = createAgent({
        systemPrompt: resolvedSystemPrompt,
        provider: agentProvider,
        tools: agentTools,
        initialHistory,
        onAfterTurn,
      });

      // Pass the shared readline to the terminal channel when --tool-confirm
      // is active; otherwise the channel creates its own internally.
      await runTerminalChannel({ agent, rl: sharedRl });
    });
}
