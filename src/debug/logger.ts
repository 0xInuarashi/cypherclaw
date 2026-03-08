// debug/logger.ts
// ----------------
// Pretty-printing loggers that write structured traces to stdout.
//
// Two independent loggers, each activated by its own CLI flag:
//
//   createDebugLogger()  →  --debug
//     Shows the high-level agentic loop: which round, which messages,
//     which tools were called, and the final text reply.
//
//     [llm ↑] round 1 · 2 messages · tools: bash, read_file
//       system    · You are a helpful assistant.
//       user      · what files are in this directory?
//
//     [llm ↓] tool_call  bash
//       {"command":"ls -la"}
//
//     [tool ✓] bash
//       │ total 32
//       │ drwxr-xr-x 5 user group ...
//
//     [llm ↓] text
//       │ Here are the files ...
//
//   createRawLogger()  →  --raw
//     Prints the exact JSON body sent to and received from the API —
//     no parsing, no summarisation. What you see is what the wire saw.
//
//     [raw ↑] request body
//       │ { "model": "gpt-4o", "messages": [...], ... }
//
//     [raw ↓] response body
//       │ { "choices": [...], "usage": {...} }
//
//   combineLoggers(...loggers)
//     Merges any number of loggers into one callback. Used in register.chat.ts
//     to compose --debug and --raw when both flags are present.
//
// Colors (ANSI, no chalk dependency):
//   Cyan     — LLM requests / raw bodies
//   Green    — LLM text response (final answer)
//   Yellow   — Tool calls requested by the model
//   Magenta  — Tool execution results
//   Gray     — Detail / content lines

import type { DebugLogger, DebugEvent } from "./events.js";

// ANSI escape helpers — avoids a chalk import just for this module.
const C = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// Indent every line of a multi-line string with a prefix string.
function indent(text: string, prefix = "    "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

// Truncate a string to maxLen chars, appending "…" if cut.
function trunc(s: string, maxLen = 300): string {
  return s.length > maxLen ? s.slice(0, maxLen) + C.dim("…") : s;
}

// Format an args object as compact JSON, single-line if short enough.
function formatArgs(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, null, 2);
  const compact = JSON.stringify(args);
  return compact.length <= 80 ? compact : json;
}

// ── Debug logger (--debug) ────────────────────────────────────────────────────
// Shows the high-level agentic loop: rounds, messages, tool calls, final reply.
// Does NOT include the raw API payloads — use --raw for that.

export function createDebugLogger(): DebugLogger {
  return function log(event: DebugEvent): void {
    switch (event.type) {
      // ── Outbound LLM request summary ────────────────────────────────────
      case "llm_request": {
        const toolNames = event.tools.map((t) => t.name).join(", ");
        console.log(
          "\n" +
            C.cyan(C.bold("[llm ↑]")) +
            C.gray(
              ` round ${event.round} · ${event.messages.length} messages` +
                (event.tools.length ? ` · tools: ${toolNames}` : ""),
            ),
        );
        for (const msg of event.messages) {
          const role = msg.role.padEnd(9);
          console.log(C.gray(`  ${role}·`) + " " + trunc(msg.content));
        }
        break;
      }

      // ── Final text reply from the model ─────────────────────────────────
      case "llm_response_text": {
        console.log("\n" + C.green(C.bold("[llm ↓]")) + C.gray(" text"));
        console.log(indent(trunc(event.text, 500), C.gray("  │ ")));
        console.log();
        break;
      }

      // ── Tool call requested by the model ────────────────────────────────
      case "llm_tool_call": {
        console.log(
          "\n" +
            C.yellow(C.bold("[llm ↓]")) +
            C.gray(" tool_call") +
            "  " +
            C.yellow(event.name),
        );
        console.log(indent(formatArgs(event.args), "  "));
        break;
      }

      // ── Tool execution result ────────────────────────────────────────────
      case "tool_result": {
        console.log("\n" + C.magenta(C.bold("[tool ✓]")) + " " + C.magenta(event.name));
        console.log(indent(event.output, C.gray("  │ ")));
        break;
      }

      // ── Token usage for this round ───────────────────────────────────────
      case "llm_token_usage": {
        const { input, output, cacheRead, cacheCreation } = event.usage;
        const parts: string[] = [
          `in: ${input}`,
          `out: ${output}`,
        ];
        if (cacheRead > 0)    parts.push(`cache_read: ${cacheRead}`);
        if (cacheCreation > 0) parts.push(`cache_create: ${cacheCreation}`);
        console.log(
          C.dim(`  [tokens r${event.round}] `) + C.gray(parts.join("  ")),
        );
        break;
      }

      // Raw events are intentionally ignored here — handled by createRawLogger.
      default:
        break;
    }
  };
}

// ── Raw logger (--raw) ────────────────────────────────────────────────────────
// Prints the exact JSON bodies exchanged with the API — no summarisation.
// Ignores all non-raw events so it can be used independently of --debug.

export function createRawLogger(): DebugLogger {
  return function log(event: DebugEvent): void {
    switch (event.type) {
      // ── Raw JSON body sent to the API ────────────────────────────────────
      case "llm_raw_request": {
        console.log("\n" + C.cyan(C.bold("[raw ↑]")) + C.gray(" request body"));
        console.log(indent(JSON.stringify(event.body, null, 2), C.gray("  │ ")));
        break;
      }

      // ── Raw JSON body received from the API ──────────────────────────────
      case "llm_raw_response": {
        console.log("\n" + C.cyan(C.bold("[raw ↓]")) + C.gray(" response body"));
        console.log(indent(JSON.stringify(event.body, null, 2), C.gray("  │ ")));
        break;
      }

      // Debug events are intentionally ignored here — handled by createDebugLogger.
      default:
        break;
    }
  };
}

// ── Round logger (always on) ──────────────────────────────────────────────────
// Prints just the "[llm ↑] round X" line on every API call.
// Always active in normal chat — no flag required.

export function createRoundLogger(): DebugLogger {
  return function log(event: DebugEvent): void {
    if (event.type === "llm_request") {
      console.log(C.cyan(C.bold("[llm ↑]")) + C.gray(` round ${event.round}`));
    }
  };
}

// ── Combiner ──────────────────────────────────────────────────────────────────
// Merges any number of loggers into a single callback. Each event is forwarded
// to every logger in order. Used when both --debug and --raw are active.

export function combineLoggers(...loggers: DebugLogger[]): DebugLogger {
  return (event: DebugEvent) => {
    for (const logger of loggers) {
      logger(event);
    }
  };
}
