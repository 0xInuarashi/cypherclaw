"use strict";
// providers/openai-compatible.ts
// --------------------------------
// A shared agentic loop implementation for any API that speaks the OpenAI
// Chat Completions format. Both our OpenAI and OpenRouter providers delegate
// here — the only differences between them are the base URL, auth header
// value, and a couple of extra headers. The loop logic is identical.
//
// The agentic loop:
//   1. Send the conversation + tool definitions to the API.
//   2. If the model replies with plain text (finish_reason "stop") → done.
//   3. If the model wants to call tools (finish_reason "tool_calls"):
//        a. Add the assistant's message (containing the tool call requests)
//           to the native history so the model knows what it asked for.
//        b. Execute each requested tool in parallel.
//        c. Add one "role: tool" message per result so the model sees the
//           output of each call.
//        d. Go back to step 1 with the updated history.
//   4. Safety valve: cap at MAX_TOOL_ROUNDS to prevent infinite loops.
//
// Native OpenAI message types (internal to this file):
//   These differ from our shared Message type — they include tool-specific
//   roles ("tool") and structured tool_call fields that the API requires.
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
exports.createOpenAICompatibleProvider = createOpenAICompatibleProvider;
// How many tool-call rounds to allow before giving up.
var MAX_TOOL_ROUNDS = 10;
// Convert our shared Message type into the OpenAI native format.
function toNativeMessages(messages) {
    return messages.map(function (m) { return ({ role: m.role, content: m.content }); });
}
// Convert our ToolDefinition into the shape the OpenAI API expects.
function toOAITool(tool) {
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    };
}
function createOpenAICompatibleProvider(opts) {
    var _a;
    var emit = (_a = opts.onEvent) !== null && _a !== void 0 ? _a : (function () { });
    return {
        chat: function (messages, tools) {
            return __awaiter(this, void 0, void 0, function () {
                var nativeMessages, oaiTools, toolMap, round, requestBody, res, body, data, choice, text, results, _i, results_1, result;
                var _this = this;
                var _a, _b, _c;
                return __generator(this, function (_d) {
                    switch (_d.label) {
                        case 0:
                            nativeMessages = toNativeMessages(messages);
                            oaiTools = tools && tools.length > 0 ? tools.map(toOAITool) : undefined;
                            toolMap = new Map((_a = tools === null || tools === void 0 ? void 0 : tools.map(function (t) { return [t.name, t]; })) !== null && _a !== void 0 ? _a : []);
                            round = 0;
                            _d.label = 1;
                        case 1:
                            if (!(round < MAX_TOOL_ROUNDS)) return [3 /*break*/, 8];
                            // Emit the outbound request so the debugger can show what's being sent.
                            emit({ type: "llm_request", round: round + 1, messages: messages, tools: tools !== null && tools !== void 0 ? tools : [] });
                            requestBody = __assign({ model: opts.model, messages: nativeMessages }, (oaiTools ? { tools: oaiTools } : {}));
                            // Emit the raw request body before sending so the full payload is visible.
                            emit({ type: "llm_raw_request", body: requestBody });
                            return [4 /*yield*/, fetch(opts.apiUrl, {
                                    method: "POST",
                                    headers: __assign({ "Content-Type": "application/json", Authorization: "Bearer ".concat(opts.apiKey) }, opts.extraHeaders),
                                    body: JSON.stringify(requestBody),
                                })];
                        case 2:
                            res = _d.sent();
                            if (!!res.ok) return [3 /*break*/, 4];
                            return [4 /*yield*/, res.text()];
                        case 3:
                            body = _d.sent();
                            throw new Error("API error ".concat(res.status, ": ").concat(body));
                        case 4: return [4 /*yield*/, res.json()];
                        case 5:
                            data = (_d.sent());
                            // Emit the raw response body exactly as received from the API.
                            emit({ type: "llm_raw_response", body: data });
                            choice = data.choices[0];
                            // ── Step 2: plain text reply → we're done ────────────────────────────
                            if (choice.finish_reason === "stop" || !((_b = choice.message.tool_calls) === null || _b === void 0 ? void 0 : _b.length)) {
                                text = choice.message.content;
                                if (!text)
                                    throw new Error("Model returned an empty response");
                                emit({ type: "llm_response_text", text: text });
                                return [2 /*return*/, text];
                            }
                            // ── Step 3: the model wants to call tools ────────────────────────────
                            // 3a. Record the assistant's message in native history.
                            nativeMessages.push({
                                role: "assistant",
                                content: (_c = choice.message.content) !== null && _c !== void 0 ? _c : null,
                                tool_calls: choice.message.tool_calls,
                            });
                            return [4 /*yield*/, Promise.all(choice.message.tool_calls.map(function (toolCall) { return __awaiter(_this, void 0, void 0, function () {
                                    var name, tool, output_1, args, output_2, output;
                                    return __generator(this, function (_a) {
                                        switch (_a.label) {
                                            case 0:
                                                name = toolCall.function.name;
                                                tool = toolMap.get(name);
                                                if (!tool) {
                                                    output_1 = "Error: unknown tool \"".concat(name, "\"");
                                                    emit({ type: "tool_result", name: name, output: output_1 });
                                                    return [2 /*return*/, { tool_call_id: toolCall.id, output: output_1 }];
                                                }
                                                args = {};
                                                try {
                                                    args = JSON.parse(toolCall.function.arguments);
                                                }
                                                catch (_b) {
                                                    output_2 = "Error: could not parse tool arguments: ".concat(toolCall.function.arguments);
                                                    emit({ type: "tool_result", name: name, output: output_2 });
                                                    return [2 /*return*/, { tool_call_id: toolCall.id, output: output_2 }];
                                                }
                                                // Emit the call intent before executing so the user sees it immediately.
                                                emit({ type: "llm_tool_call", name: name, args: args });
                                                return [4 /*yield*/, tool.execute(args)];
                                            case 1:
                                                output = _a.sent();
                                                emit({ type: "tool_result", name: name, output: output });
                                                return [2 /*return*/, { tool_call_id: toolCall.id, output: output }];
                                        }
                                    });
                                }); }))];
                        case 6:
                            results = _d.sent();
                            // Add one "role: tool" message per result.
                            for (_i = 0, results_1 = results; _i < results_1.length; _i++) {
                                result = results_1[_i];
                                nativeMessages.push({
                                    role: "tool",
                                    tool_call_id: result.tool_call_id,
                                    content: result.output,
                                });
                            }
                            _d.label = 7;
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
