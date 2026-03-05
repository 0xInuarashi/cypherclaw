"use strict";
// tools/read-file.ts
// -------------------
// A tool that lets the LLM read the contents of a file from disk.
//
// Why have this when the bash tool can already `cat` a file?
//   1. Semantic clarity — the model knows this is a dedicated "read file"
//      operation, not a general shell command. It's less likely to misuse it.
//   2. Safer on restricted environments where bash execution may be disabled.
//   3. Direct file I/O is slightly more reliable than spawning a subprocess.
//
// Output is capped at MAX_OUTPUT_CHARS to keep it within context limits.
// Binary files return an error rather than garbled output.
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
exports.readFileTool = void 0;
var promises_1 = require("node:fs/promises");
var node_path_1 = require("node:path");
var MAX_OUTPUT_CHARS = 20000;
exports.readFileTool = {
    name: "read_file",
    description: "Read the contents of a file from disk and return them as a string. " +
        "Provide a path relative to the current working directory or an absolute path.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Path to the file to read (relative or absolute).",
            },
        },
        required: ["path"],
    },
    execute: function (args) {
        return __awaiter(this, void 0, void 0, function () {
            var filePath, content, err_1, error;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        filePath = node_path_1.default.resolve(args["path"]);
                        process.stderr.write("\u001B[33m[read_file]\u001B[0m ".concat(filePath, "\n"));
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, promises_1.default.readFile(filePath, "utf-8")];
                    case 2:
                        content = _b.sent();
                        if (content.length > MAX_OUTPUT_CHARS) {
                            return [2 /*return*/, (content.slice(0, MAX_OUTPUT_CHARS) +
                                    "\n\n[file truncated \u2014 ".concat(content.length - MAX_OUTPUT_CHARS, " chars omitted]"))];
                        }
                        return [2 /*return*/, content || "(empty file)"];
                    case 3:
                        err_1 = _b.sent();
                        error = err_1;
                        if (error.code === "ENOENT") {
                            return [2 /*return*/, "Error: file not found: ".concat(filePath)];
                        }
                        if (error.code === "EISDIR") {
                            return [2 /*return*/, "Error: path is a directory, not a file: ".concat(filePath)];
                        }
                        return [2 /*return*/, "Error reading file: ".concat((_a = error.message) !== null && _a !== void 0 ? _a : String(err_1))];
                    case 4: return [2 /*return*/];
                }
            });
        });
    },
};
