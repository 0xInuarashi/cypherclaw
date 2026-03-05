"use strict";
// cli/run.ts
// ----------
// The runCli() function is the true starting point of the application logic.
// entry.ts calls this as soon as it loads, passing the raw process.argv array.
//
// Responsibilities:
//   1. Load environment variables from a .env file so that API keys and config
//      are available before any command action handler runs.
//   2. Build the Commander program (the object that knows all commands and flags).
//   3. Install global process-level error handlers so that any unhandled async
//      error anywhere in the app is caught, logged, and results in a clean exit
//      rather than a cryptic Node.js crash dump.
//   4. Hand argv to Commander so it can parse the command the user typed and
//      call the appropriate action handler.
//
// Why load dotenv here rather than in each command?
//   Centralising it here guarantees env vars are present before any module
//   (even lazily imported ones) tries to read process.env. Doing it per-command
//   would risk a race condition where an import side-effect reads env vars
//   before dotenv has populated them.
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
exports.runCli = runCli;
var node_process_1 = require("node:process");
var dotenv_1 = require("dotenv");
function runCli() {
    return __awaiter(this, arguments, void 0, function (argv) {
        var buildProgram, program;
        if (argv === void 0) { argv = node_process_1.default.argv; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // Load .env from the current working directory. `override: false` means we
                    // never clobber variables that are already set in the shell environment —
                    // the real environment always takes precedence over the .env file.
                    // If no .env file exists the call is a no-op (dotenv does not throw).
                    (0, dotenv_1.config)({ override: false });
                    return [4 /*yield*/, Promise.resolve().then(function () { return require("./program.js"); })];
                case 1:
                    buildProgram = (_a.sent()).buildProgram;
                    program = buildProgram();
                    // Catch any unhandled exception thrown synchronously from anywhere in the
                    // process (e.g. inside a callback that isn't wrapped in try/catch). Without
                    // this handler Node would print a raw stack trace and may or may not exit.
                    node_process_1.default.on("uncaughtException", function (error) {
                        console.error("[cypherclaw] Uncaught exception:", error instanceof Error ? error.stack : error);
                        node_process_1.default.exit(1);
                    });
                    // Same idea but for async errors — a Promise that was rejected and nobody
                    // ever attached a .catch() handler to. These are silent by default in older
                    // Node versions, which makes bugs very hard to find.
                    node_process_1.default.on("unhandledRejection", function (reason) {
                        console.error("[cypherclaw] Unhandled rejection:", reason);
                        node_process_1.default.exit(1);
                    });
                    // Let Commander parse the argv array. parseAsync is used instead of parse
                    // because our command action handlers are async functions (they await things
                    // like file I/O, HTTP requests, etc.).
                    return [4 /*yield*/, program.parseAsync(argv)];
                case 2:
                    // Let Commander parse the argv array. parseAsync is used instead of parse
                    // because our command action handlers are async functions (they await things
                    // like file I/O, HTTP requests, etc.).
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
