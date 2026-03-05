"use strict";
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
exports.wrapWithConfirm = wrapWithConfirm;
// ANSI colour helpers — keep output visually distinct without a chalk dependency.
var yellow = function (s) { return "\u001B[33m".concat(s, "\u001B[0m"); };
var red = function (s) { return "\u001B[31m".concat(s, "\u001B[0m"); };
var gray = function (s) { return "\u001B[90m".concat(s, "\u001B[0m"); };
var bold = function (s) { return "\u001B[1m".concat(s, "\u001B[0m"); };
// Ask the user a yes/no question using the existing readline instance.
// Resolves to true if the user types "y" or "yes" (case-insensitive), false otherwise.
function askConfirm(rl, question) {
    return new Promise(function (resolve) {
        rl.question(question, function (answer) {
            resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
        });
    });
}
// Wraps each tool in the array with a confirmation gate.
// Returns a new array — the original tools are not mutated.
function wrapWithConfirm(tools, rl) {
    return tools.map(function (tool) { return (__assign(__assign({}, tool), { execute: function (args) {
            return __awaiter(this, void 0, void 0, function () {
                var argsJson, argsPretty, approved;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            argsJson = JSON.stringify(args);
                            argsPretty = argsJson.length <= 80
                                ? argsJson
                                : JSON.stringify(args, null, 2);
                            // Print a clear, visually distinct confirmation block.
                            // Writing to stdout (not stderr) so it interleaves correctly with other
                            // console output and readline's display.
                            process.stdout.write("\n".concat(yellow(bold("┌─ tool-confirm ─────────────────────────────"))) +
                                "\n".concat(yellow("│"), " ").concat(bold(tool.name)) +
                                "\n".concat(yellow("│"), " ").concat(gray(argsPretty.split("\n").join("\n".concat(yellow("│"), " ")))) +
                                "\n".concat(yellow("└────────────────────────────────────────────"), "\n"));
                            return [4 /*yield*/, askConfirm(rl, "".concat(yellow("  Approve?"), " ").concat(gray("[y/n]"), " "))];
                        case 1:
                            approved = _a.sent();
                            if (!approved) {
                                process.stdout.write("  ".concat(red("✗ denied"), "\n\n"));
                                // Return a denial string the model can reason about.
                                return [2 /*return*/, "[denied by user — tool was not executed]"];
                            }
                            process.stdout.write("  ".concat(yellow("✓ approved"), "\n\n"));
                            // Delegate to the original tool implementation.
                            return [2 /*return*/, tool.execute(args)];
                    }
                });
            });
        } })); });
}
