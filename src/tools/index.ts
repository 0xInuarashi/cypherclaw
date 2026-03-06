// tools/index.ts
// ---------------
// Barrel file that exports all built-in tools and the default tool set.
//
// `defaultTools` is the list passed to the agent when no custom toolset is
// specified. Start here and extend as needed — adding a new tool requires
// only writing a new file and adding it to this array.
//
// Current built-in tools:
//   bash         — Run any shell command; the most versatile tool.
//   read_file    — Read a file from disk by path.
//   write_file   — Write (create/overwrite) a file on disk.
//   append_file  — Append content to a file without overwriting existing content.
//   web_fetch    — Fetch a public web page through a browser-backed session.
//   web_action   — Drive a hosted browser for interactive web tasks.

export type { ToolDefinition } from "./types.js";
export { bashTool } from "./bash.js";
export { readFileTool } from "./read-file.js";
export { writeFileTool } from "./write-file.js";
export { appendFileTool } from "./append-file.js";
export { webFetchTool } from "./web-fetch.js";
export { webActionTool } from "./web-action.js";

import { bashTool } from "./bash.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { appendFileTool } from "./append-file.js";
import { webFetchTool } from "./web-fetch.js";
import { webActionTool } from "./web-action.js";
import type { ToolDefinition } from "./types.js";

// The set of tools enabled by default in every chat session.
export const defaultTools: ToolDefinition[] = [
  bashTool,
  readFileTool,
  writeFileTool,
  appendFileTool,
  webFetchTool,
  webActionTool,
];
