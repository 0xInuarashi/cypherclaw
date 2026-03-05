"use strict";
// channels/terminal/index.ts
// ---------------------------
// The Terminal channel — the simplest possible messaging channel.
//
// In CypherClaw, a "channel" is any interface through which a user sends
// messages to the agent and receives replies. The terminal channel does this
// entirely inside the current process using Node's built-in `readline` module:
// it prints a prompt, waits for the user to type something and press Enter,
// forwards the input to the agent, then prints the agent's reply and repeats.
//
// This channel is deliberately decoupled from the agent. It receives an
// `AgentFn` (a plain async function) through its options, so it doesn't care
// whether the agent echoes text, calls an LLM, or queries a database — it just
// calls it and prints whatever comes back. This makes both the channel and the
// agent independently testable and replaceable.
//
// How to exit:
//   - Type "exit" or "quit" and press Enter.
//   - Press Ctrl+C (which closes the readline interface, triggering `close`).
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
exports.runTerminalChannel = runTerminalChannel;
var node_readline_1 = require("node:readline");
var node_process_1 = require("node:process");
function runTerminalChannel(opts) {
    return __awaiter(this, void 0, void 0, function () {
        var prompt, rl, ask;
        var _this = this;
        var _a, _b;
        return __generator(this, function (_c) {
            prompt = (_a = opts.prompt) !== null && _a !== void 0 ? _a : "you> ";
            rl = (_b = opts.rl) !== null && _b !== void 0 ? _b : node_readline_1.default.createInterface({
                input: node_process_1.default.stdin,
                output: node_process_1.default.stdout,
                terminal: true,
            });
            console.log('[cypherclaw] Terminal channel ready. Type "exit" or press Ctrl+C to quit.\n');
            ask = function () {
                rl.question(prompt, function (input) { return __awaiter(_this, void 0, void 0, function () {
                    var trimmed, reply, error_1;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                trimmed = input.trim();
                                // Allow the user to end the session explicitly.
                                if (trimmed === "exit" || trimmed === "quit") {
                                    console.log("[cypherclaw] Goodbye.");
                                    rl.close(); // triggers the 'close' event below → process.exit
                                    return [2 /*return*/];
                                }
                                // Skip empty lines; just show the prompt again.
                                if (!trimmed) {
                                    ask();
                                    return [2 /*return*/];
                                }
                                _a.label = 1;
                            case 1:
                                _a.trys.push([1, 3, , 4]);
                                return [4 /*yield*/, opts.agent(trimmed)];
                            case 2:
                                reply = _a.sent();
                                console.log("\nclaw> ".concat(reply, "\n"));
                                return [3 /*break*/, 4];
                            case 3:
                                error_1 = _a.sent();
                                // Don't crash on agent errors — print the problem and allow the user
                                // to try again.
                                console.error("[cypherclaw] Agent error:", error_1 instanceof Error ? error_1.message : error_1);
                                return [3 /*break*/, 4];
                            case 4:
                                // Start the next turn.
                                ask();
                                return [2 /*return*/];
                        }
                    });
                }); });
            };
            // When the readline interface closes (Ctrl+C or rl.close() above), exit the
            // process so the CLI command returns cleanly.
            rl.on("close", function () {
                node_process_1.default.exit(0);
            });
            // Kick off the first turn.
            ask();
            return [2 /*return*/];
        });
    });
}
