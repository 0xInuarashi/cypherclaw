// tools/confirm.ts
// -----------------
// Wraps a set of ToolDefinitions so that every tool call requires explicit
// user approval before it executes.
//
// How it works:
//   wrapWithConfirm(tools, rl) returns a new array where each tool's execute()
//   is replaced with a version that first prints the tool name + arguments,
//   then asks "Approve? [y/n]" using the provided readline interface, and only
//   calls the real execute() if the user answers "y".
//
// Why the readline interface must be shared:
//   Node's readline module takes exclusive ownership of stdin. If we created a
//   second readline interface here, it would race with the terminal channel's
//   interface for keystrokes — causing double-reads, garbled output, or an
//   abrupt session close.
//
//   By reusing the SAME readline instance that the terminal channel uses, we
//   guarantee only one readline is ever listening to stdin at any time. The
//   main chat loop's rl.question() has already resolved before the agent runs
//   (the user pressed Enter to send their message), so no active question is
//   pending when we call rl.question() here for the confirmation prompt.
//
// Denial result:
//   If the user answers anything other than "y" / "yes", the tool is NOT
//   executed and the model receives the string "[denied]" as the tool output.
//   This gives the model enough signal to acknowledge the denial and continue
//   reasoning without crashing the loop.

import type readline from "node:readline";
import type { ToolDefinition } from "./types.js";

// ANSI colour helpers — keep output visually distinct without a chalk dependency.
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const gray   = (s: string) => `\x1b[90m${s}\x1b[0m`;
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;

// Ask the user a yes/no question using the existing readline instance.
// Resolves to true if the user types "y" or "yes" (case-insensitive), false otherwise.
function askConfirm(rl: readline.Interface, question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

// Wraps each tool in the array with a confirmation gate.
// Returns a new array — the original tools are not mutated.
export function wrapWithConfirm(
  tools: ToolDefinition[],
  rl: readline.Interface,
): ToolDefinition[] {
  return tools.map((tool) => ({
    ...tool,

    async execute(args: Record<string, unknown>): Promise<string> {
      // Format args as compact JSON if short, pretty-printed if long.
      const argsJson = JSON.stringify(args);
      const argsPretty =
        argsJson.length <= 80
          ? argsJson
          : JSON.stringify(args, null, 2);

      // Print a clear, visually distinct confirmation block.
      // Writing to stdout (not stderr) so it interleaves correctly with other
      // console output and readline's display.
      process.stdout.write(
        `\n${yellow(bold("┌─ tool-confirm ─────────────────────────────"))}` +
        `\n${yellow("│")} ${bold(tool.name)}` +
        `\n${yellow("│")} ${gray(argsPretty.split("\n").join(`\n${yellow("│")} `))}` +
        `\n${yellow("└────────────────────────────────────────────")}\n`,
      );

      // Pause readline's display so the prompt doesn't flicker while we write.
      // rl.question() resumes it automatically before showing the question.
      const approved = await askConfirm(rl, `${yellow("  Approve?")} ${gray("[y/n]")} `);

      if (!approved) {
        process.stdout.write(`  ${red("✗ denied")}\n\n`);
        // Return a denial string the model can reason about.
        return "[denied by user — tool was not executed]";
      }

      process.stdout.write(`  ${yellow("✓ approved")}\n\n`);

      // Delegate to the original tool implementation.
      return tool.execute(args);
    },
  }));
}
