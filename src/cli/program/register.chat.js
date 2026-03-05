"use strict";
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatCommand = registerChatCommand;
var node_readline_1 = require("node:readline");
var node_process_1 = require("node:process");
var node_crypto_1 = require("node:crypto");
function registerChatCommand(program) {
    var _this = this;
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
        .option("--history-limit <n>", "Max turns to load from a saved session (default: 50)", "50")
        .action(function (opts) { return __awaiter(_this, void 0, void 0, function () {
        var createAgent, runTerminalChannel, onEvent, _a, createDebugLogger, createRawLogger, combineLoggers, loggers, sharedRl, sessionName, initialHistory, savedMessageCount, historyLimit, loadSession, loaded, agentProvider, loadConfig, createProvider, config, agentTools, defaultTools, wrapWithConfirm, appendToSession, onAfterTurn, agent;
        var _this = this;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require("../../agent/index.js"); })];
                case 1:
                    createAgent = (_d.sent()).createAgent;
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("../../channels/terminal/index.js"); })];
                case 2:
                    runTerminalChannel = (_d.sent()).runTerminalChannel;
                    if (!(opts.debug || opts.raw)) return [3 /*break*/, 4];
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("../../debug/logger.js"); })];
                case 3:
                    _a = _d.sent(), createDebugLogger = _a.createDebugLogger, createRawLogger = _a.createRawLogger, combineLoggers = _a.combineLoggers;
                    loggers = __spreadArray(__spreadArray([], (opts.debug ? [createDebugLogger()] : []), true), (opts.raw ? [createRawLogger()] : []), true);
                    onEvent = combineLoggers.apply(void 0, loggers);
                    _d.label = 4;
                case 4:
                    sharedRl = opts.toolConfirm
                        ? node_readline_1.default.createInterface({
                            input: node_process_1.default.stdin,
                            output: node_process_1.default.stdout,
                            terminal: true,
                        })
                        : undefined;
                    sessionName = (_b = opts.session) !== null && _b !== void 0 ? _b : (0, node_crypto_1.randomUUID)();
                    savedMessageCount = 0;
                    historyLimit = Math.max(1, parseInt(opts.historyLimit, 10) || 50);
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("../../sessions/index.js"); })];
                case 5:
                    loadSession = (_d.sent()).loadSession;
                    return [4 /*yield*/, loadSession(sessionName, historyLimit)];
                case 6:
                    loaded = _d.sent();
                    if (loaded && loaded.length > 0) {
                        initialHistory = loaded;
                        savedMessageCount = loaded.length;
                        console.log("[cypherclaw] Resumed session \"".concat(sessionName, "\" ") +
                            "(".concat(loaded.length, " messages loaded, limit: ").concat(historyLimit, " turns)\n"));
                    }
                    else {
                        console.log("[cypherclaw] Session: ".concat(sessionName, "\n"));
                    }
                    if (!opts.provider) return [3 /*break*/, 9];
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("../../config/index.js"); })];
                case 7:
                    loadConfig = (_d.sent()).loadConfig;
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("../../providers/index.js"); })];
                case 8:
                    createProvider = (_d.sent()).createProvider;
                    config = loadConfig();
                    agentProvider = createProvider(config, onEvent);
                    _d.label = 9;
                case 9:
                    if (!(opts.tools && agentProvider)) return [3 /*break*/, 13];
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("../../tools/index.js"); })];
                case 10:
                    defaultTools = (_d.sent()).defaultTools;
                    if (!(opts.toolConfirm && sharedRl)) return [3 /*break*/, 12];
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("../../tools/confirm.js"); })];
                case 11:
                    wrapWithConfirm = (_d.sent()).wrapWithConfirm;
                    agentTools = wrapWithConfirm(defaultTools, sharedRl);
                    return [3 /*break*/, 13];
                case 12:
                    agentTools = defaultTools;
                    _d.label = 13;
                case 13: return [4 /*yield*/, Promise.resolve().then(function () { return require("../../sessions/index.js"); })];
                case 14:
                    appendToSession = (_d.sent()).appendToSession;
                    onAfterTurn = function (history) { return __awaiter(_this, void 0, void 0, function () {
                        var newMessages;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    newMessages = history.slice(savedMessageCount);
                                    if (!(newMessages.length > 0)) return [3 /*break*/, 2];
                                    return [4 /*yield*/, appendToSession(sessionName, newMessages)];
                                case 1:
                                    _a.sent();
                                    savedMessageCount = history.length;
                                    _a.label = 2;
                                case 2: return [2 /*return*/];
                            }
                        });
                    }); };
                    agent = createAgent({
                        systemPrompt: (_c = opts.system) !== null && _c !== void 0 ? _c : node_process_1.default.env.CYPHERCLAW_SYSTEM_PROMPT,
                        provider: agentProvider,
                        tools: agentTools,
                        initialHistory: initialHistory,
                        onAfterTurn: onAfterTurn,
                    });
                    // Pass the shared readline to the terminal channel when --tool-confirm
                    // is active; otherwise the channel creates its own internally.
                    return [4 /*yield*/, runTerminalChannel({ agent: agent, rl: sharedRl })];
                case 15:
                    // Pass the shared readline to the terminal channel when --tool-confirm
                    // is active; otherwise the channel creates its own internally.
                    _d.sent();
                    return [2 /*return*/];
            }
        });
    }); });
}
