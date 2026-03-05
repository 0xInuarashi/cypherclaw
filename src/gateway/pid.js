"use strict";
// gateway/pid.ts
// ---------------
// Utilities for managing a PID (Process ID) file.
//
// A PID file is the standard Unix pattern for tracking a long-running daemon:
//   - When the daemon starts, it writes its own PID (a plain integer) to a
//     known file location on disk.
//   - When the CLI wants to stop or check on the daemon, it reads that file to
//     get the PID, then uses OS signals to communicate with the process.
//   - When the daemon exits cleanly, it deletes the file.
//
// We store the PID file in the OS temp directory (e.g. /tmp on Linux/macOS)
// because it's writable by any user and is automatically cleaned up on reboot.
// The filename is fixed so every CLI invocation knows exactly where to look.
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
exports.writePid = writePid;
exports.readPid = readPid;
exports.clearPid = clearPid;
exports.isProcessRunning = isProcessRunning;
var promises_1 = require("node:fs/promises");
var node_os_1 = require("node:os");
var node_path_1 = require("node:path");
// Absolute path to the PID file, e.g. "/tmp/cypherclaw.pid".
var PID_FILE = node_path_1.default.join(node_os_1.default.tmpdir(), "cypherclaw.pid");
// Write the given PID to the PID file, overwriting any previous content.
// Called by the gateway server immediately after it successfully starts.
function writePid(pid) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, promises_1.default.writeFile(PID_FILE, String(pid), "utf-8")];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// Read the PID from the PID file. Returns null if the file doesn't exist or
// its content isn't a valid integer (e.g. it was corrupted or left empty).
function readPid() {
    return __awaiter(this, void 0, void 0, function () {
        var content, pid, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, promises_1.default.readFile(PID_FILE, "utf-8")];
                case 1:
                    content = _b.sent();
                    pid = parseInt(content.trim(), 10);
                    return [2 /*return*/, isNaN(pid) ? null : pid];
                case 2:
                    _a = _b.sent();
                    // File not found (ENOENT) or any other read error — treat as "no daemon".
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// Delete the PID file. Called on clean shutdown so the next `status` check
// doesn't find a stale file and incorrectly report the daemon as running.
// Errors (e.g. file already gone) are silently ignored because the end result
// is the same: no PID file on disk.
function clearPid() {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, promises_1.default.unlink(PID_FILE)];
                case 1:
                    _b.sent();
                    return [3 /*break*/, 3];
                case 2:
                    _a = _b.sent();
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// Check whether a process with the given PID is currently running on this
// machine. We exploit the fact that kill(pid, 0) is a no-op signal — it does
// not actually send anything — but it throws an error if the PID doesn't
// exist or we don't have permission to signal it.
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (_a) {
        return false;
    }
}
