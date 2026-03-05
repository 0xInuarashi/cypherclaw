"use strict";
// tools/index.ts
// ---------------
// Barrel file that exports all built-in tools and the default tool set.
//
// `defaultTools` is the list passed to the agent when no custom toolset is
// specified. Start here and extend as needed — adding a new tool requires
// only writing a new file and adding it to this array.
//
// Current built-in tools:
//   bash        — Run any shell command; the most versatile tool.
//   read_file   — Read a file from disk by path.
//   write_file  — Write (create/overwrite) a file on disk.
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultTools = exports.writeFileTool = exports.readFileTool = exports.bashTool = void 0;
var bash_js_1 = require("./bash.js");
Object.defineProperty(exports, "bashTool", { enumerable: true, get: function () { return bash_js_1.bashTool; } });
var read_file_js_1 = require("./read-file.js");
Object.defineProperty(exports, "readFileTool", { enumerable: true, get: function () { return read_file_js_1.readFileTool; } });
var write_file_js_1 = require("./write-file.js");
Object.defineProperty(exports, "writeFileTool", { enumerable: true, get: function () { return write_file_js_1.writeFileTool; } });
var bash_js_2 = require("./bash.js");
var read_file_js_2 = require("./read-file.js");
var write_file_js_2 = require("./write-file.js");
// The set of tools enabled by default in every chat session.
exports.defaultTools = [bash_js_2.bashTool, read_file_js_2.readFileTool, write_file_js_2.writeFileTool];
