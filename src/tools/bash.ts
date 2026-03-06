// tools/bash.ts
// --------------
// A tool that lets the LLM run arbitrary shell commands on the local machine.
//
// This is the most powerful tool in the kit — and the most dangerous. The
// model can read files, run scripts, install packages, check system state,
// and more. Use it only in trusted environments.
//
// Design decisions:
//   - stdout and stderr are both captured and merged so the model sees the
//     full picture (errors are just as informative as successful output).
//   - A hard timeout (30 s) prevents runaway commands from hanging the loop.
//   - Output is capped at MAX_OUTPUT_CHARS characters. LLM context windows are
//     finite; sending megabytes of logs would waste tokens and likely exceed
//     the model's limit.
//   - The current working directory is inherited from the CypherClaw process,
//     so the agent "starts" in whatever directory you launched the CLI from.
//
// Human note: 
//   - instead of simply truncating, should we have a LLM or something 
//     summarize the output so that it's better context-aligned?

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "./types/types.js";

const execAsync = promisify(exec);

// Maximum number of characters to send back to the model.
// Anything beyond this is truncated with a note so the model knows output was cut.
const MAX_OUTPUT_CHARS = 8_000;

// How long (ms) to wait before forcibly killing the child process.
const TIMEOUT_MS = 30_000;

export const bashTool: ToolDefinition = {
  name: "bash",
  description:
    "Run a shell command on the local machine and get its output. " +
    "Use this to read files, check system state, run scripts, or do anything " +
    "you would do in a terminal. The working directory is wherever the CLI was launched from.",

  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute.",
      },
    },
    required: ["command"],
  },

  async execute(args): Promise<string> {
    const command = args["command"] as string;

    // Print what the tool is about to run so the user can follow along
    // in the terminal. Uses stderr so it doesn't interfere with piped output.
    process.stderr.write(`\x1b[33m[bash]\x1b[0m ${command}\n`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: TIMEOUT_MS,
        // Merge streams so the model sees both in natural order. Because
        // execAsync separates them, we concatenate manually below.
        maxBuffer: 10 * 1024 * 1024, // 10 MB — raw buffer before our truncation
      });

      // Combine stdout and stderr the same way a terminal would show them.
      // If stderr is non-empty, label it so the model can distinguish.
      let output = stdout;
      if (stderr) {
        output += (output ? "\n" : "") + `[stderr]\n${stderr}`;
      }
      if (!output) {
        output = "(no output)";
      }

      // Truncate if too long.
      if (output.length > MAX_OUTPUT_CHARS) {
        output =
          output.slice(0, MAX_OUTPUT_CHARS) +
          `\n\n[output truncated — ${output.length - MAX_OUTPUT_CHARS} chars omitted]`;
      }

      return output;
    } catch (err: unknown) {
      // exec rejects when the command exits with a non-zero code or times out.
      // We still want the model to see the output so it can understand what
      // went wrong and potentially correct itself.
      const error = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };

      if (error.killed) {
        return `[command timed out after ${TIMEOUT_MS / 1000}s]`;
      }

      const parts: string[] = [];
      if (error.stdout) parts.push(error.stdout);
      if (error.stderr) parts.push(`[stderr]\n${error.stderr}`);
      if (!parts.length) parts.push(error.message ?? "unknown error");

      let output = parts.join("\n");
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(0, MAX_OUTPUT_CHARS) + "\n[truncated]";
      }
      return output;
    }
  },
};
