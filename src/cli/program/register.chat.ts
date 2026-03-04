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
//   --system / -s   Override the system prompt from the command line.
//   --no-tools      Disable tool calling (plain chat mode, no shell access).
//   --no-provider   Skip LLM config entirely and fall back to the echo stub.
//   --debug         Print high-level agentic loop traces (rounds, tool calls, replies).
//   --raw           Print the exact raw JSON bodies sent to and received from the API.
//   Both flags can be combined: --debug --raw

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
    .action(async (opts: { system?: string; provider: boolean; tools: boolean; debug?: boolean; raw?: boolean }) => {
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
        agentTools = defaultTools;
      }

      const agent = createAgent({
        systemPrompt: opts.system ?? process.env.CYPHERCLAW_SYSTEM_PROMPT,
        provider: agentProvider,
        tools: agentTools,
      });

      await runTerminalChannel({ agent });
    });
}
