"use strict";
// agent/index.ts
// ---------------
// The agent is the "brain" of CypherClaw — it receives a user message,
// maintains the conversation history, calls the LLM provider (with tools if
// provided), and returns the model's final reply.
//
// Architecture note:
//   The agent is expressed as a plain async function type (`AgentFn`) rather
//   than a class. This keeps things composable: any function that takes a
//   string and returns a Promise<string> qualifies as an agent. The channel
//   (e.g. terminal) calls the agent without caring about its internals, and the
//   agent doesn't know or care which channel it's running inside.
//
// Conversation history:
//   LLMs are stateless — every API call is independent. We simulate memory by
//   keeping a local array of all messages exchanged so far. On each call we
//   send the full history so the model has context about prior turns.
//
// Tool calling:
//   If tools are passed in AgentOptions, they're forwarded to the provider on
//   every call. The provider runs the full agentic loop (call → execute tools
//   → call again) and returns the final text reply. The agent itself doesn't
//   need to know the loop happened — it just gets a string back.
//
// AgentOptions:
//   systemPrompt — instruction string given to the model before any user
//                  messages. Sets persona, constraints, and goals.
//   provider     — the LLM backend (openai / anthropic / openrouter).
//                  If omitted, the agent falls back to an echo stub.
//   tools        — list of tools the model is allowed to call.
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
exports.createAgent = createAgent;
// Factory that creates and returns an agent function.
// All state (history, options) is captured in the closure.
function createAgent(opts) {
    var _this = this;
    // Running log of user ↔ assistant messages.
    // System messages are NOT stored here; they're prepended fresh on every
    // call so the system prompt is always the first message the model sees.
    // If initialHistory was provided (resuming a saved session), seed from it.
    var history = (opts === null || opts === void 0 ? void 0 : opts.initialHistory) ? __spreadArray([], opts.initialHistory, true) : [];
    return function (userMessage) { return __awaiter(_this, void 0, void 0, function () {
        var reply_1, messages, reply;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!!(opts === null || opts === void 0 ? void 0 : opts.provider)) return [3 /*break*/, 3];
                    reply_1 = "Echo: ".concat(userMessage);
                    history.push({ role: "user", content: userMessage });
                    history.push({ role: "assistant", content: reply_1 });
                    if (!(opts === null || opts === void 0 ? void 0 : opts.onAfterTurn)) return [3 /*break*/, 2];
                    return [4 /*yield*/, opts.onAfterTurn(history)];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/, reply_1];
                case 3:
                    // Append the user's message to history before calling the model.
                    history.push({ role: "user", content: userMessage });
                    messages = [];
                    if (opts.systemPrompt) {
                        messages.push({ role: "system", content: opts.systemPrompt });
                    }
                    messages.push.apply(messages, history);
                    return [4 /*yield*/, opts.provider.chat(messages, opts.tools)];
                case 4:
                    reply = _a.sent();
                    // Store the assistant's reply so future turns have full context.
                    history.push({ role: "assistant", content: reply });
                    if (!(opts === null || opts === void 0 ? void 0 : opts.onAfterTurn)) return [3 /*break*/, 6];
                    return [4 /*yield*/, opts.onAfterTurn(history)];
                case 5:
                    _a.sent();
                    _a.label = 6;
                case 6: return [2 /*return*/, reply];
            }
        });
    }); };
}
