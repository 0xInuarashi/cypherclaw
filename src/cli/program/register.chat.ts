// cli/program/register.chat.ts
// -----------------------------
// Registers the `cypherclaw chat` command.
//
// This command wires together the three main building blocks:
//   1. Config (src/config/index.ts)            — reads env vars for provider / key / model.
//   2. The agent  (src/agent/index.ts)         — maintains conversation history, calls the LLM.
//   3. The terminal channel                    — readline prompt loop for input/output.
//
// The command itself is intentionally thin. It loads config, instantiates the
// provider and agent, then hands control to the channel. When the user types
// "exit" or presses Ctrl+C, the channel closes and this command returns.
//
// Flags:
//   --system / -s   Override the system prompt from the command line.
//                   Useful for quick experiments without editing .env.
//   --no-provider   Skip LLM config and fall back to the echo stub. Handy
//                   for testing the pipeline without an API key.

import type { Command } from "commander";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start an interactive chat session in the terminal")
    .option("-s, --system <prompt>", "Custom system prompt for the agent")
    .option("--no-provider", "Use echo stub instead of a real LLM provider")
    .action(async (opts: { system?: string; provider: boolean }) => {
      const { createAgent } = await import("../../agent/index.js");
      const { runTerminalChannel } = await import("../../channels/terminal/index.js");

      // `opts.provider` is true by default; false when the user passes --no-provider.
      // When false, we skip config loading entirely (no API key required).
      let agentProvider;
      if (opts.provider) {
        // Load config from env vars (dotenv has already run in run.ts).
        // If required vars are missing, loadConfig() throws a clear error.
        const { loadConfig } = await import("../../config/index.js");
        const { createProvider } = await import("../../providers/index.js");
        const config = loadConfig();
        agentProvider = createProvider(config);
      }

      const agent = createAgent({
        // Prefer the CLI flag; fall back to the env var set in .env.
        systemPrompt: opts.system ?? process.env.CYPHERCLAW_SYSTEM_PROMPT,
        provider: agentProvider,
      });

      await runTerminalChannel({ agent });
    });
}
