"use strict";
// gateway/server.ts
// ------------------
// Defines and starts the gateway HTTP server.
//
// The gateway is the central "control plane" of CypherClaw. Right now it's a
// minimal HTTP server with a single health-check endpoint, but it will grow to
// handle routing between channels (Terminal, Telegram, WhatsApp, …) and the
// agent logic.
//
// Why HTTP?
//   HTTP gives us a simple, universally understood way for the CLI commands
//   (`status`, future `send`, etc.) to talk to the background daemon without
//   needing a shared socket or custom protocol. The `status` command, for
//   example, just does a GET / to confirm the server is alive.
//
// Constants (GATEWAY_PORT, GATEWAY_HOST) are exported so that other modules —
// `start`, `status` — all agree on the same address without hard-coding it.
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
exports.GATEWAY_HOST = exports.GATEWAY_PORT = void 0;
exports.startGatewayServer = startGatewayServer;
var node_http_1 = require("node:http");
var node_process_1 = require("node:process");
var pid_js_1 = require("./pid.js");
// The port the gateway listens on. 59152 is in the ephemeral/private range and
// unlikely to conflict with other well-known services.
exports.GATEWAY_PORT = 59152;
// Bind only to localhost. The gateway is meant to be a local-only service;
// binding to 0.0.0.0 would expose it on all network interfaces.
exports.GATEWAY_HOST = "127.0.0.1";
// Request handler for all incoming HTTP requests.
// For now there's just one endpoint: GET / → { status: "ok", pid: <number> }.
// The `pid` field is useful for `cypherclaw status` to cross-check against the
// PID file and confirm it's talking to the right process.
function handleRequest(_req, res) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", pid: node_process_1.default.pid }));
}
// Start the HTTP server and bind it to the given port (defaulting to
// GATEWAY_PORT). Returns a GatewayServer handle once the server is listening.
//
// Immediately after binding, we write the current process PID to the PID file
// so that `stop` and `status` commands can locate this daemon later.
function startGatewayServer(opts) {
    return __awaiter(this, void 0, void 0, function () {
        var port, server;
        var _this = this;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    port = (_a = opts === null || opts === void 0 ? void 0 : opts.port) !== null && _a !== void 0 ? _a : exports.GATEWAY_PORT;
                    server = (0, node_http_1.createServer)(handleRequest);
                    // server.listen is callback-based; we wrap it in a Promise so callers can
                    // await it. The 'error' listener covers bind failures (e.g. port in use).
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            server.listen(port, exports.GATEWAY_HOST, resolve);
                            server.once("error", reject);
                        })];
                case 1:
                    // server.listen is callback-based; we wrap it in a Promise so callers can
                    // await it. The 'error' listener covers bind failures (e.g. port in use).
                    _b.sent();
                    // Record this process's PID so the CLI can find and signal this daemon later.
                    return [4 /*yield*/, (0, pid_js_1.writePid)(node_process_1.default.pid)];
                case 2:
                    // Record this process's PID so the CLI can find and signal this daemon later.
                    _b.sent();
                    console.log("[cypherclaw] Gateway started on ".concat(exports.GATEWAY_HOST, ":").concat(port, " (pid ").concat(node_process_1.default.pid, ")"));
                    return [2 /*return*/, {
                            port: port,
                            close: function () { return __awaiter(_this, void 0, void 0, function () {
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0: 
                                        // Remove the PID file first so that any concurrent `status` call
                                        // immediately sees the daemon as stopped, even before the server socket
                                        // is fully closed.
                                        return [4 /*yield*/, (0, pid_js_1.clearPid)()];
                                        case 1:
                                            // Remove the PID file first so that any concurrent `status` call
                                            // immediately sees the daemon as stopped, even before the server socket
                                            // is fully closed.
                                            _a.sent();
                                            return [4 /*yield*/, new Promise(function (resolve, reject) {
                                                    server.close(function (err) { return (err ? reject(err) : resolve()); });
                                                })];
                                        case 2:
                                            _a.sent();
                                            return [2 /*return*/];
                                    }
                                });
                            }); },
                        }];
            }
        });
    });
}
