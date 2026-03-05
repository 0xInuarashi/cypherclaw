"use strict";
// cli/program/register.stop.ts
// -----------------------------
// Registers the `cypherclaw stop` command.
//
// Stopping the daemon is a two-phase operation:
//   Phase 1 — Graceful (SIGTERM):
//     We ask the process to shut down cleanly. The daemon's signal handlers
//     (in gateway/daemon.ts) catch SIGTERM, close the HTTP server, delete the
//     PID file, and exit. We then poll every 250 ms to see if it's gone.
//
//   Phase 2 — Forceful (SIGKILL), only if phase 1 times out:
//     After ~5 seconds (20 × 250 ms) we give up waiting and send SIGKILL,
//     which the OS enforces immediately. The process cannot intercept SIGKILL.
//
// Edge cases handled:
//   - No PID file at all → gateway was never started (or already cleaned up).
//   - PID file exists but no process at that PID → stale file from a crash;
//     we delete it and report the situation.
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
exports.registerStopCommand = registerStopCommand;
var pid_js_1 = require("../../gateway/pid.js");
function registerStopCommand(program) {
    var _this = this;
    program
        .command("stop")
        .description("Stop the CypherClaw gateway")
        .action(function () { return __awaiter(_this, void 0, void 0, function () {
        var pid, attempts;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, pid_js_1.readPid)()];
                case 1:
                    pid = _a.sent();
                    if (pid === null) {
                        console.log("[cypherclaw] Gateway is not running.");
                        return [2 /*return*/];
                    }
                    if (!!(0, pid_js_1.isProcessRunning)(pid)) return [3 /*break*/, 3];
                    // PID file exists but the process is gone — the daemon crashed or was
                    // killed externally without cleaning up. Remove the stale file.
                    console.log("[cypherclaw] Gateway process not found — cleaning up stale PID file.");
                    return [4 /*yield*/, (0, pid_js_1.clearPid)()];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
                case 3:
                    // Phase 1: politely ask the process to stop.
                    process.kill(pid, "SIGTERM");
                    console.log("[cypherclaw] Sent SIGTERM to gateway (pid ".concat(pid, ")."));
                    attempts = 0;
                    _a.label = 4;
                case 4:
                    if (!(attempts < 20 && (0, pid_js_1.isProcessRunning)(pid))) return [3 /*break*/, 6];
                    return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 250); })];
                case 5:
                    _a.sent();
                    attempts++;
                    return [3 /*break*/, 4];
                case 6:
                    // Phase 2: if still alive after the grace period, force-kill it.
                    if ((0, pid_js_1.isProcessRunning)(pid)) {
                        process.kill(pid, "SIGKILL");
                        console.log("[cypherclaw] Force-killed gateway (pid ".concat(pid, ")."));
                    }
                    else {
                        console.log("[cypherclaw] Gateway stopped.");
                    }
                    // Whether we killed it gracefully or by force, clean up the PID file.
                    // (The daemon normally deletes it itself on SIGTERM, but SIGKILL prevents
                    // that, so we do it here as a safety net.)
                    return [4 /*yield*/, (0, pid_js_1.clearPid)()];
                case 7:
                    // Whether we killed it gracefully or by force, clean up the PID file.
                    // (The daemon normally deletes it itself on SIGTERM, but SIGKILL prevents
                    // that, so we do it here as a safety net.)
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
}
