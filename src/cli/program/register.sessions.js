"use strict";
// cli/program/register.sessions.ts
// ---------------------------------
// Registers the `cypherclaw sessions` command group.
//
// Sub-commands:
//   cypherclaw sessions list
//     Prints all saved sessions, sorted most-recently-updated first.
//     Columns: name | messages (total on disk) | last updated (relative time).
//
//   cypherclaw sessions delete <name>
//     Prompts for y/n confirmation, then removes the session file.
//     Prints a clear error if the session doesn't exist.
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
exports.registerSessionsCommand = registerSessionsCommand;
// Formats a Date as a human-readable relative time string, e.g.:
//   "just now", "5 minutes ago", "3 hours ago", "2 days ago"
function relativeTime(date) {
    var diffMs = Date.now() - date.getTime();
    var diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60)
        return "just now";
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60)
        return "".concat(diffMin, " minute").concat(diffMin === 1 ? "" : "s", " ago");
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24)
        return "".concat(diffHr, " hour").concat(diffHr === 1 ? "" : "s", " ago");
    var diffDay = Math.floor(diffHr / 24);
    return "".concat(diffDay, " day").concat(diffDay === 1 ? "" : "s", " ago");
}
function registerSessionsCommand(program) {
    var _this = this;
    // The `sessions` command itself is a group — it has no action of its own,
    // only sub-commands. Running `cypherclaw sessions` alone prints help.
    var sessions = program
        .command("sessions")
        .description("Manage saved conversation sessions");
    // ── sessions list ───────────────────────────────────────────────────────────
    sessions
        .command("list")
        .description("List all saved sessions")
        .action(function () { return __awaiter(_this, void 0, void 0, function () {
        var listSessions, list, nameWidth, msgWidth, header, divider, _i, list_1, session, row;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require("../../sessions/index.js"); })];
                case 1:
                    listSessions = (_a.sent()).listSessions;
                    return [4 /*yield*/, listSessions()];
                case 2:
                    list = _a.sent();
                    if (list.length === 0) {
                        console.log("No saved sessions. Start one with: cypherclaw chat --session <name>");
                        return [2 /*return*/];
                    }
                    nameWidth = Math.max.apply(Math, __spreadArray([20], list.map(function (s) { return s.name.length; }), false)) + 2;
                    msgWidth = 10;
                    header = "NAME".padEnd(nameWidth) +
                        "MESSAGES".padEnd(msgWidth) +
                        "UPDATED";
                    divider = "─".repeat(header.length);
                    console.log("\n" + header);
                    console.log(divider);
                    for (_i = 0, list_1 = list; _i < list_1.length; _i++) {
                        session = list_1[_i];
                        row = session.name.padEnd(nameWidth) +
                            String(session.messageCount).padEnd(msgWidth) +
                            relativeTime(session.updatedAt);
                        console.log(row);
                    }
                    console.log();
                    return [2 /*return*/];
            }
        });
    }); });
    // ── sessions delete <name> ──────────────────────────────────────────────────
    sessions
        .command("delete <name>")
        .description("Delete a saved session")
        .action(function (name) { return __awaiter(_this, void 0, void 0, function () {
        var deleteSession, readline, rl;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require("../../sessions/index.js"); })];
                case 1:
                    deleteSession = (_a.sent()).deleteSession;
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("node:readline"); })];
                case 2:
                    readline = _a.sent();
                    rl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                        terminal: true,
                    });
                    return [4 /*yield*/, new Promise(function (resolve) {
                            rl.question("Delete session \"".concat(name, "\"? This cannot be undone. [y/n] "), function (answer) { return __awaiter(_this, void 0, void 0, function () {
                                var confirmed, deleted;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            rl.close();
                                            confirmed = answer.trim().toLowerCase() === "y" ||
                                                answer.trim().toLowerCase() === "yes";
                                            if (!confirmed) {
                                                console.log("Cancelled.");
                                                resolve();
                                                return [2 /*return*/];
                                            }
                                            return [4 /*yield*/, deleteSession(name)];
                                        case 1:
                                            deleted = _a.sent();
                                            if (deleted) {
                                                console.log("Deleted session \"".concat(name, "\"."));
                                            }
                                            else {
                                                console.error("Session \"".concat(name, "\" not found."));
                                                process.exitCode = 1;
                                            }
                                            resolve();
                                            return [2 /*return*/];
                                    }
                                });
                            }); });
                        })];
                case 3:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
}
