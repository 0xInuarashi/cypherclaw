"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDebugLogger = createDebugLogger;
exports.createRawLogger = createRawLogger;
exports.combineLoggers = combineLoggers;
// ANSI escape helpers — avoids a chalk import just for this module.
var C = {
    cyan: function (s) { return "\u001B[36m".concat(s, "\u001B[0m"); },
    green: function (s) { return "\u001B[32m".concat(s, "\u001B[0m"); },
    yellow: function (s) { return "\u001B[33m".concat(s, "\u001B[0m"); },
    magenta: function (s) { return "\u001B[35m".concat(s, "\u001B[0m"); },
    gray: function (s) { return "\u001B[90m".concat(s, "\u001B[0m"); },
    bold: function (s) { return "\u001B[1m".concat(s, "\u001B[0m"); },
    dim: function (s) { return "\u001B[2m".concat(s, "\u001B[0m"); },
};
// Indent every line of a multi-line string with a prefix string.
function indent(text, prefix) {
    if (prefix === void 0) { prefix = "    "; }
    return text
        .split("\n")
        .map(function (line) { return prefix + line; })
        .join("\n");
}
// Truncate a string to maxLen chars, appending "…" if cut.
function trunc(s, maxLen) {
    if (maxLen === void 0) { maxLen = 300; }
    return s.length > maxLen ? s.slice(0, maxLen) + C.dim("…") : s;
}
// Format an args object as compact JSON, single-line if short enough.
function formatArgs(args) {
    var json = JSON.stringify(args, null, 2);
    var compact = JSON.stringify(args);
    return compact.length <= 80 ? compact : json;
}
// ── Debug logger (--debug) ────────────────────────────────────────────────────
// Shows the high-level agentic loop: rounds, messages, tool calls, final reply.
// Does NOT include the raw API payloads — use --raw for that.
function createDebugLogger() {
    return function log(event) {
        switch (event.type) {
            // ── Outbound LLM request summary ────────────────────────────────────
            case "llm_request": {
                var toolNames = event.tools.map(function (t) { return t.name; }).join(", ");
                console.log("\n" +
                    C.cyan(C.bold("[llm ↑]")) +
                    C.gray(" round ".concat(event.round, " \u00B7 ").concat(event.messages.length, " messages") +
                        (event.tools.length ? " \u00B7 tools: ".concat(toolNames) : "")));
                for (var _i = 0, _a = event.messages; _i < _a.length; _i++) {
                    var msg = _a[_i];
                    var role = msg.role.padEnd(9);
                    console.log(C.gray("  ".concat(role, "\u00B7")) + " " + trunc(msg.content));
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
                console.log("\n" +
                    C.yellow(C.bold("[llm ↓]")) +
                    C.gray(" tool_call") +
                    "  " +
                    C.yellow(event.name));
                console.log(indent(formatArgs(event.args), "  "));
                break;
            }
            // ── Tool execution result ────────────────────────────────────────────
            case "tool_result": {
                console.log("\n" + C.magenta(C.bold("[tool ✓]")) + " " + C.magenta(event.name));
                console.log(indent(trunc(event.output, 400), C.gray("  │ ")));
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
function createRawLogger() {
    return function log(event) {
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
// ── Combiner ──────────────────────────────────────────────────────────────────
// Merges any number of loggers into a single callback. Each event is forwarded
// to every logger in order. Used when both --debug and --raw are active.
function combineLoggers() {
    var loggers = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        loggers[_i] = arguments[_i];
    }
    return function (event) {
        for (var _i = 0, loggers_1 = loggers; _i < loggers_1.length; _i++) {
            var logger = loggers_1[_i];
            logger(event);
        }
    };
}
