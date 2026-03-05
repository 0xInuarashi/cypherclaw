"use strict";
// tools/write-file.ts
// --------------------
// A tool that lets the LLM write (create or overwrite) a file on disk.
//
// This is intentionally a full overwrite rather than an append or patch:
//   - It's the simplest mental model for the agent ("here is the entire file").
//   - Partial edits via text are error-prone; overwriting the whole file is
//     reliable as long as the model has seen the current contents first.
//   - If the model needs to append, it can read the file first, then write
//     the combined content back.
//
// Intermediate directories are created automatically so the model doesn't need
// to worry about mkdir.
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
exports.writeFileTool = void 0;
var promises_1 = require("node:fs/promises");
var node_path_1 = require("node:path");
exports.writeFileTool = {
    name: "write_file",
    description: "Write content to a file on disk, creating it if it doesn't exist or " +
        "overwriting it if it does. Parent directories are created automatically. " +
        "Provide a path relative to the current working directory or an absolute path.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Path to the file to write (relative or absolute).",
            },
            content: {
                type: "string",
                description: "The full content to write to the file.",
            },
        },
        required: ["path", "content"],
    },
    execute: function (args) {
        return __awaiter(this, void 0, void 0, function () {
            var filePath, content, err_1, error;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        filePath = node_path_1.default.resolve(args["path"]);
                        content = args["content"];
                        process.stderr.write("\u001B[33m[write_file]\u001B[0m ".concat(filePath, "\n"));
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 4, , 5]);
                        // Ensure parent directories exist before writing.
                        return [4 /*yield*/, promises_1.default.mkdir(node_path_1.default.dirname(filePath), { recursive: true })];
                    case 2:
                        // Ensure parent directories exist before writing.
                        _b.sent();
                        return [4 /*yield*/, promises_1.default.writeFile(filePath, content, "utf-8")];
                    case 3:
                        _b.sent();
                        return [2 /*return*/, "Written ".concat(content.length, " characters to ").concat(filePath)];
                    case 4:
                        err_1 = _b.sent();
                        error = err_1;
                        return [2 /*return*/, "Error writing file: ".concat((_a = error.message) !== null && _a !== void 0 ? _a : String(err_1))];
                    case 5: return [2 /*return*/];
                }
            });
        });
    },
};
