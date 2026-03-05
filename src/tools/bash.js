"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bashTool = void 0;
var node_child_process_1 = require("node:child_process");
var node_util_1 = require("node:util");
var execAsync = (0, node_util_1.promisify)(node_child_process_1.exec);
// Maximum number of characters to send back to the model.
// Anything beyond this is truncated with a note so the model knows output was cut.
var MAX_OUTPUT_CHARS = 8000;
// How long (ms) to wait before forcibly killing the child process.
var TIMEOUT_MS = 30000;
exports.bashTool = {
    name: "bash",
    description: "Run a shell command on the local machine and get its output. " +
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
    execute: function (args) {
        return __awaiter(this, void 0, void 0, function () {
            var command, _a, stdout, stderr, output, err_1, error, parts, output;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        command = args["command"];
                        // Print what the tool is about to run so the user can follow along
                        // in the terminal. Uses stderr so it doesn't interfere with piped output.
                        process.stderr.write("\u001B[33m[bash]\u001B[0m ".concat(command, "\n"));
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, execAsync(command, {
                                timeout: TIMEOUT_MS,
                                // Merge streams so the model sees both in natural order. Because
                                // execAsync separates them, we concatenate manually below.
                                maxBuffer: 10 * 1024 * 1024, // 10 MB — raw buffer before our truncation
                            })];
                    case 2:
                        _a = _c.sent(), stdout = _a.stdout, stderr = _a.stderr;
                        output = stdout;
                        if (stderr) {
                            output += (output ? "\n" : "") + "[stderr]\n".concat(stderr);
                        }
                        if (!output) {
                            output = "(no output)";
                        }
                        // Truncate if too long.
                        if (output.length > MAX_OUTPUT_CHARS) {
                            output =
                                output.slice(0, MAX_OUTPUT_CHARS) +
                                    "\n\n[output truncated \u2014 ".concat(output.length - MAX_OUTPUT_CHARS, " chars omitted]");
                        }
                        return [2 /*return*/, output];
                    case 3:
                        err_1 = _c.sent();
                        error = err_1;
                        if (error.killed) {
                            return [2 /*return*/, "[command timed out after ".concat(TIMEOUT_MS / 1000, "s]")];
                        }
                        parts = [];
                        if (error.stdout)
                            parts.push(error.stdout);
                        if (error.stderr)
                            parts.push("[stderr]\n".concat(error.stderr));
                        if (!parts.length)
                            parts.push((_b = error.message) !== null && _b !== void 0 ? _b : "unknown error");
                        output = parts.join("\n");
                        if (output.length > MAX_OUTPUT_CHARS) {
                            output = output.slice(0, MAX_OUTPUT_CHARS) + "\n[truncated]";
                        }
                        return [2 /*return*/, output];
                    case 4: return [2 /*return*/];
                }
            });
        });
    },
};
