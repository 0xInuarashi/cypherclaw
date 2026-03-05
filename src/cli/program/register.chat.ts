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
//   --system / -s    Override the system prompt from the command line.
//   --no-tools       Disable tool calling (plain chat mode, no shell access).
//   --no-provider    Skip LLM config entirely and fall back to the echo stub.
//   --debug          Print high-level agentic loop traces (rounds, tool calls, replies).
//   --raw            Print the exact raw JSON bodies sent to and received from the API.
//   --tool-confirm   Require y/n approval before every tool call executes.
//
// Flags can be freely combined, e.g. --debug --raw --tool-confirm.
//
// readline sharing (--tool-confirm):
//   When --tool-confirm is active we create ONE readline interface up front and
//   share it between the confirm wrapper and the terminal channel. This is
//   critical: if two readline interfaces both listen on stdin simultaneously,
//   they race for keystrokes, causing double-reads, mangled output, and abrupt
//   session termination. A single shared instance avoids all of that.

import readline from "node:readline";
import process from "node:process";
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
    .action(async (opts: {
      system?: string;
      provider: boolean;
      tools: boolean;
      debug?: boolean;
      raw?: boolean;
      toolConfirm?: boolean;
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
          const { wrapWithConfirm } = await import("../../tools/confirm.js");
          agentTools = wrapWithConfirm(defaultTools, sharedRl);
        } else {
          agentTools = defaultTools;
        }
      }

      const agent = createAgent({
        systemPrompt: opts.system ?? process.env.CYPHERCLAW_SYSTEM_PROMPT,
        provider: agentProvider,
        tools: agentTools,
      });

      // Pass the shared readline to the terminal channel when --tool-confirm
      // is active; otherwise the channel creates its own internally.
      await runTerminalChannel({ agent, rl: sharedRl });
    });
}
