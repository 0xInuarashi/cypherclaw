"use strict";
// providers/anthropic.ts
// -----------------------
// Provider implementation for the Anthropic Messages API, including the
// agentic tool-calling loop.
//
// API reference: https://docs.anthropic.com/en/api/messages
//
// Anthropic's API differs from OpenAI's in two important ways:
//
//   1. System prompt — sent as a top-level "system" field, NOT as a message
//      with role "system". We extract it from the history before sending.
//
//   2. Tool calling format — entirely different schema:
//        Request tools:  { name, description, input_schema: { type, properties, required } }
//        Tool calls in response: content blocks with type "tool_use"
//        Tool results:   sent back as a "user" message containing blocks with
//                        type "tool_result" — NOT as a separate "tool" role.
//
// The agentic loop here mirrors openai-compatible.ts in structure but uses
// Anthropic's native types throughout.
//
// Request shape:
//   { model, max_tokens, system?, messages, tools? }
//   messages only contain role "user" | "assistant"
//   content can be a string OR an array of content blocks
//
// Response shape:
//   { content: ContentBlock[], stop_reason: "end_turn" | "tool_use" | ... }
//   ContentBlock: { type: "text", text } | { type: "tool_use", id, name, input }
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.createAnthropicProvider = createAnthropicProvider;
var ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
var ANTHROPIC_VERSION = "2023-06-01";
var DEFAULT_MAX_TOKENS = 8192;
var MAX_TOOL_ROUNDS = 10;
// Convert our ToolDefinition to Anthropic's tool schema.
// Key difference from OpenAI: the parameters field is called "input_schema".
function toAnthropicTool(tool) {
    return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
    };
}
// Convert our shared Message[] to Anthropic's native format.
// System messages are extracted separately; only user/assistant remain.
function toNativeMessages(messages) {
    return messages
        .filter(function (m) { return m.role !== "system"; })
        .map(function (m) { return ({ role: m.role, content: m.content }); });
}
// ── Main factory ─────────────────────────────────────────────────────────────
function createAnthropicProvider(opts) {
    var _a;
    var emit = (_a = opts.onEvent) !== null && _a !== void 0 ? _a : (function () { });
    return {
        chat: function (messages, tools) {
            return __awaiter(this, void 0, void 0, function () {
                var systemMessage, nativeMessages, anthropicTools, toolMap, round, requestBody, res, text, data, textBlock, textBlock, toolUseBlocks, toolResults;
                var _this = this;
                var _a, _b;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            systemMessage = messages.find(function (m) { return m.role === "system"; });
                            nativeMessages = toNativeMessages(messages);
                            anthropicTools = tools && tools.length > 0 ? tools.map(toAnthropicTool) : undefined;
                            toolMap = new Map((_a = tools === null || tools === void 0 ? void 0 : tools.map(function (t) { return [t.name, t]; })) !== null && _a !== void 0 ? _a : []);
                            round = 0;
                            _c.label = 1;
                        case 1:
                            if (!(round < MAX_TOOL_ROUNDS)) return [3 /*break*/, 8];
                            // Emit the outbound request so the debugger can show what's being sent.
                            emit({ type: "llm_request", round: round + 1, messages: messages, tools: tools !== null && tools !== void 0 ? tools : [] });
                            requestBody = __assign({ model: opts.model, max_tokens: DEFAULT_MAX_TOKENS, messages: nativeMessages }, (anthropicTools ? { tools: anthropicTools } : {}));
                            // Only include "system" if we actually have one.
                            if (systemMessage) {
                                requestBody["system"] = systemMessage.content;
                            }
                            // Emit the raw request body before sending so the full payload is visible.
                            emit({ type: "llm_raw_request", body: requestBody });
                            return [4 /*yield*/, fetch(ANTHROPIC_API_URL, {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                        "x-api-key": opts.apiKey,
                                        "anthropic-version": ANTHROPIC_VERSION,
                                    },
                                    body: JSON.stringify(requestBody),
                                })];
                        case 2:
                            res = _c.sent();
                            if (!!res.ok) return [3 /*break*/, 4];
                            return [4 /*yield*/, res.text()];
                        case 3:
                            text = _c.sent();
                            throw new Error("Anthropic API error ".concat(res.status, ": ").concat(text));
                        case 4: return [4 /*yield*/, res.json()];
                        case 5:
                            data = (_c.sent());
                            // Emit the raw response body exactly as received from the API.
                            emit({ type: "llm_raw_response", body: data });
                            // ── Step 2: plain text reply → we're done ──────────────────────────
                            if (data.stop_reason === "end_turn") {
                                textBlock = data.content.find(function (b) { return b.type === "text"; });
                                if (!(textBlock === null || textBlock === void 0 ? void 0 : textBlock.text))
                                    throw new Error("Anthropic returned an empty response");
                                emit({ type: "llm_response_text", text: textBlock.text });
                                return [2 /*return*/, textBlock.text];
                            }
                            // ── Step 3: the model wants to call tools ──────────────────────────
                            if (data.stop_reason !== "tool_use") {
                                textBlock = data.content.find(function (b) { return b.type === "text"; });
                                return [2 /*return*/, (_b = textBlock === null || textBlock === void 0 ? void 0 : textBlock.text) !== null && _b !== void 0 ? _b : "(no response)"];
                            }
                            // 3a. Record the assistant's full response (text + tool_use blocks)
                            //     so the model knows what it requested in the next turn.
                            nativeMessages.push({ role: "assistant", content: data.content });
                            toolUseBlocks = data.content.filter(function (b) { return b.type === "tool_use"; });
                            return [4 /*yield*/, Promise.all(toolUseBlocks.map(function (block) { return __awaiter(_this, void 0, void 0, function () {
                                    var tool, output_1, output;
                                    return __generator(this, function (_a) {
                                        switch (_a.label) {
                                            case 0:
                                                tool = toolMap.get(block.name);
                                                if (!tool) {
                                                    output_1 = "Error: unknown tool \"".concat(block.name, "\"");
                                                    emit({ type: "tool_result", name: block.name, output: output_1 });
                                                    return [2 /*return*/, { type: "tool_result", tool_use_id: block.id, content: output_1 }];
                                                }
                                                // Emit the call intent before executing.
                                                emit({ type: "llm_tool_call", name: block.name, args: block.input });
                                                return [4 /*yield*/, tool.execute(block.input)];
                                            case 1:
                                                output = _a.sent();
                                                emit({ type: "tool_result", name: block.name, output: output });
                                                return [2 /*return*/, { type: "tool_result", tool_use_id: block.id, content: output }];
                                        }
                                    });
                                }); }))];
                        case 6:
                            toolResults = _c.sent();
                            // 3d. Anthropic requires tool results in a single "user" message
                            //     containing an array of tool_result blocks — one per tool call.
                            nativeMessages.push({ role: "user", content: toolResults });
                            _c.label = 7;
                        case 7:
                            round++;
                            return [3 /*break*/, 1];
                        case 8: throw new Error("Agentic loop exceeded ".concat(MAX_TOOL_ROUNDS, " tool call rounds"));
                    }
                });
            });
        },
    };
}
