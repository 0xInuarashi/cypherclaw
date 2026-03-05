"use strict";
// cli/program/register.status.ts
// --------------------------------
// Registers the `cypherclaw status` command.
//
// Status reporting happens in two layers:
//
//   Layer 1 — OS process check (via PID file):
//     We read the PID that the daemon recorded on startup and ask the OS
//     whether a process with that ID still exists. This works even if the HTTP
//     server is wedged or overloaded.
//
//   Layer 2 — HTTP health check (via gateway):
//     If the process is alive, we attempt an HTTP GET to the gateway's root
//     endpoint. A successful response means the server is fully up and
//     accepting connections, and we can also display the port and PID from the
//     response body. A failed request (e.g. still starting up, port mismatch)
//     falls back to a gentler "running but not reachable" message.
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
exports.registerStatusCommand = registerStatusCommand;
var server_js_1 = require("../../gateway/server.js");
var pid_js_1 = require("../../gateway/pid.js");
function registerStatusCommand(program) {
    var _this = this;
    program
        .command("status")
        .description("Show the status of the CypherClaw gateway")
        .action(function () { return __awaiter(_this, void 0, void 0, function () {
        var pid, res, body, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, pid_js_1.readPid)()];
                case 1:
                    pid = _b.sent();
                    if (pid === null) {
                        console.log("[cypherclaw] Status: stopped (no PID file)");
                        return [2 /*return*/];
                    }
                    if (!(0, pid_js_1.isProcessRunning)(pid)) {
                        // The file exists but the process is gone — likely a crash without cleanup.
                        console.log("[cypherclaw] Status: stopped (stale PID ".concat(pid, ")"));
                        return [2 /*return*/];
                    }
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 5, , 6]);
                    return [4 /*yield*/, fetch("http://".concat(server_js_1.GATEWAY_HOST, ":").concat(server_js_1.GATEWAY_PORT, "/"))];
                case 3:
                    res = _b.sent();
                    return [4 /*yield*/, res.json()];
                case 4:
                    body = _b.sent();
                    console.log("[cypherclaw] Status: running  pid=".concat(body.pid, "  port=").concat(server_js_1.GATEWAY_PORT));
                    return [3 /*break*/, 6];
                case 5:
                    _a = _b.sent();
                    // The process exists but the HTTP server isn't answering — it may still
                    // be starting up, or the port in the config changed.
                    console.log("[cypherclaw] Status: running (pid ".concat(pid, ") \u2014 gateway not reachable on port ").concat(server_js_1.GATEWAY_PORT));
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    }); });
}
