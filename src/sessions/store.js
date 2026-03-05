"use strict";
// sessions/store.ts
// -----------------
// All disk I/O for named conversation sessions.
//
// Format: JSONL (JSON Lines) — one message per line, e.g.:
//   {"role":"user","content":"hello"}
//   {"role":"assistant","content":"hi there"}
//
// Why JSONL instead of a JSON array?
//   We only ever APPEND new messages (never rewrite the full file). JSONL
//   makes that trivial: one fs.appendFile per turn. A JSON array would
//   require rewriting the entire file on every save.
//
// Storage location: ~/.cypherclaw/sessions/<name>.jsonl
//
// Rolling window:
//   On load we apply a configurable history limit (default: 50 turns).
//   One "turn" = one user message + one assistant reply = 2 messages.
//   The full file is never truncated — it is the permanent archive. The
//   window only controls how much is loaded into the working context, so
//   very long sessions don't overflow the model's context window.
//
// Tool schemas are naturally absent: our Message type only contains
// { role, content }. The tool definitions sent to providers are separate
// and ephemeral — they are never part of the conversation history.
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
exports.DEFAULT_HISTORY_LIMIT = void 0;
exports.validateSessionName = validateSessionName;
exports.resolveSessionsDir = resolveSessionsDir;
exports.resolveSessionPath = resolveSessionPath;
exports.loadSession = loadSession;
exports.appendToSession = appendToSession;
exports.listSessions = listSessions;
exports.deleteSession = deleteSession;
var promises_1 = require("node:fs/promises");
var node_os_1 = require("node:os");
var node_path_1 = require("node:path");
// Default rolling window: last 50 turns (= 100 messages).
exports.DEFAULT_HISTORY_LIMIT = 50;
// Session names must be filesystem-safe: letters, numbers, dashes,
// underscores, and dots; 1–128 characters; must start with a letter or number.
var SAFE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
function validateSessionName(name) {
    var trimmed = name.trim();
    if (!SAFE_NAME_RE.test(trimmed)) {
        throw new Error("Invalid session name \"".concat(name, "\". ") +
            "Use only letters, numbers, dashes, underscores, and dots (max 128 chars).");
    }
    return trimmed;
}
// Returns ~/.cypherclaw/sessions/, creating it if it doesn't exist yet.
function resolveSessionsDir() {
    return __awaiter(this, void 0, void 0, function () {
        var dir;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    dir = node_path_1.default.join(node_os_1.default.homedir(), ".cypherclaw", "sessions");
                    return [4 /*yield*/, promises_1.default.mkdir(dir, { recursive: true })];
                case 1:
                    _a.sent();
                    return [2 /*return*/, dir];
            }
        });
    });
}
// Returns the absolute path to a session's JSONL file.
function resolveSessionPath(name) {
    return __awaiter(this, void 0, void 0, function () {
        var safe, dir;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    safe = validateSessionName(name);
                    return [4 /*yield*/, resolveSessionsDir()];
                case 1:
                    dir = _a.sent();
                    return [2 /*return*/, node_path_1.default.join(dir, "".concat(safe, ".jsonl"))];
            }
        });
    });
}
// ── Rolling window ────────────────────────────────────────────────────────────
// Slices the message array to the last (limit * 2) messages, then nudges the
// start forward until the first kept message is a "user" message. This avoids
// starting a context mid-turn with a dangling assistant message.
function applyHistoryLimit(messages, limit) {
    var maxMessages = limit * 2;
    if (messages.length <= maxMessages)
        return messages;
    // Take the tail.
    var sliced = messages.slice(messages.length - maxMessages);
    // Align to the first user message so we never start on an assistant turn.
    var firstUserIdx = sliced.findIndex(function (m) { return m.role === "user"; });
    return firstUserIdx > 0 ? sliced.slice(firstUserIdx) : sliced;
}
// ── Load ──────────────────────────────────────────────────────────────────────
// Loads a session and applies the rolling window.
// Returns null when the session file doesn't exist yet (new session).
function loadSession(name_1) {
    return __awaiter(this, arguments, void 0, function (name, historyLimit) {
        var filePath, raw, err_1, messages, _i, _a, line, trimmed, parsed;
        if (historyLimit === void 0) { historyLimit = exports.DEFAULT_HISTORY_LIMIT; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, resolveSessionPath(name)];
                case 1:
                    filePath = _b.sent();
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, promises_1.default.readFile(filePath, "utf-8")];
                case 3:
                    raw = _b.sent();
                    return [3 /*break*/, 5];
                case 4:
                    err_1 = _b.sent();
                    // File not found → new session, not an error.
                    if (err_1.code === "ENOENT")
                        return [2 /*return*/, null];
                    throw err_1;
                case 5:
                    messages = [];
                    for (_i = 0, _a = raw.split("\n"); _i < _a.length; _i++) {
                        line = _a[_i];
                        trimmed = line.trim();
                        if (!trimmed)
                            continue;
                        try {
                            parsed = JSON.parse(trimmed);
                            if (typeof parsed.role === "string" &&
                                typeof parsed.content === "string" &&
                                (parsed.role === "user" || parsed.role === "assistant")) {
                                messages.push({ role: parsed.role, content: parsed.content });
                            }
                        }
                        catch (_c) {
                            // Skip malformed lines — partial writes from a previous crash are safe.
                        }
                    }
                    return [2 /*return*/, applyHistoryLimit(messages, historyLimit)];
            }
        });
    });
}
// ── Append ────────────────────────────────────────────────────────────────────
// Appends new messages to the session file. Creates the file if needed.
// Only "user" and "assistant" roles are persisted — system messages are
// runtime config and should not be stored in the history file.
function appendToSession(name, messages) {
    return __awaiter(this, void 0, void 0, function () {
        var toWrite, filePath, lines;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    toWrite = messages.filter(function (m) { return m.role === "user" || m.role === "assistant"; });
                    if (toWrite.length === 0)
                        return [2 /*return*/];
                    return [4 /*yield*/, resolveSessionPath(name)];
                case 1:
                    filePath = _a.sent();
                    lines = toWrite.map(function (m) { return JSON.stringify({ role: m.role, content: m.content }); }).join("\n") + "\n";
                    return [4 /*yield*/, promises_1.default.appendFile(filePath, lines, "utf-8")];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// Lists all sessions sorted by most-recently-updated first.
function listSessions() {
    return __awaiter(this, void 0, void 0, function () {
        var dir, entries, _a, results;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, resolveSessionsDir()];
                case 1:
                    dir = _b.sent();
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, promises_1.default.readdir(dir, { withFileTypes: true })];
                case 3:
                    entries = _b.sent();
                    return [3 /*break*/, 5];
                case 4:
                    _a = _b.sent();
                    return [2 /*return*/, []];
                case 5:
                    results = [];
                    return [4 /*yield*/, Promise.all(entries
                            .filter(function (e) { return e.isFile() && e.name.endsWith(".jsonl"); })
                            .map(function (entry) { return __awaiter(_this, void 0, void 0, function () {
                            var absPath, _a, stat, raw, messageCount, _b;
                            return __generator(this, function (_c) {
                                switch (_c.label) {
                                    case 0:
                                        absPath = node_path_1.default.join(dir, entry.name);
                                        _c.label = 1;
                                    case 1:
                                        _c.trys.push([1, 3, , 4]);
                                        return [4 /*yield*/, Promise.all([
                                                promises_1.default.stat(absPath),
                                                promises_1.default.readFile(absPath, "utf-8"),
                                            ])];
                                    case 2:
                                        _a = _c.sent(), stat = _a[0], raw = _a[1];
                                        messageCount = raw.split("\n").filter(function (l) { return l.trim(); }).length;
                                        results.push({
                                            name: entry.name.slice(0, -6), // strip ".jsonl"
                                            messageCount: messageCount,
                                            updatedAt: stat.mtime,
                                        });
                                        return [3 /*break*/, 4];
                                    case 3:
                                        _b = _c.sent();
                                        return [3 /*break*/, 4];
                                    case 4: return [2 /*return*/];
                                }
                            });
                        }); }))];
                case 6:
                    _b.sent();
                    return [2 /*return*/, results.sort(function (a, b) { return b.updatedAt.getTime() - a.updatedAt.getTime(); })];
            }
        });
    });
}
// ── Delete ────────────────────────────────────────────────────────────────────
// Deletes a session file. Returns true if deleted, false if it didn't exist.
function deleteSession(name) {
    return __awaiter(this, void 0, void 0, function () {
        var filePath, err_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, resolveSessionPath(name)];
                case 1:
                    filePath = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, promises_1.default.unlink(filePath)];
                case 3:
                    _a.sent();
                    return [2 /*return*/, true];
                case 4:
                    err_2 = _a.sent();
                    if (err_2.code === "ENOENT")
                        return [2 /*return*/, false];
                    throw err_2;
                case 5: return [2 /*return*/];
            }
        });
    });
}
