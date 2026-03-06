// tools/index.ts
// ---------------
// Barrel file that exports all built-in tools and the default tool set.
//
// `defaultTools` is the list passed to the agent when no custom toolset is
// specified. Start here and extend as needed — adding a new tool requires
// only writing a new file and adding it to this array.
//
// Current built-in tools:
//   bash          — Run any shell command; the most versatile tool.
//   read_file     — Read a file from disk by path.
//   write_file    — Write (create/overwrite) a file on disk.
//   append_file   — Append content to a file without overwriting existing content.
//   web_fetch     — Fetch a public web page and return clean, readable text.
//   web_search    — Search the web and return a ranked list of results.
//   temp_email    — Create disposable inboxes and read incoming mail autonomously.
//   list_memory   — List files in the agent memory store (.cypherclaw/memory/).
//   read_memory   — Read a file from the agent memory store.
//   write_memory  — Write (create/overwrite) a file in the agent memory store.
//   append_memory — Append content to a file in the agent memory store.
//   list_secrets  — List names of stored secrets (values never revealed).
//   get_secret    — Retrieve a secret value by name.
//   set_secret    — Store a named secret in the encrypted secrets store.
//   delete_secret — Remove a named secret from the secrets store.

export type { ToolDefinition } from "./types/types.js";
export { bashTool } from "./bash.js";
export { readFileTool } from "./read-file.js";
export { writeFileTool } from "./write-file.js";
export { appendFileTool } from "./append-file.js";
export { webFetchTool } from "./web-fetch.js";
export { webSearchTool } from "./web-search.js";
export { tempEmailTool } from "./temp-email.js";
export { listMemoryTool } from "./memory-list.js";
export { readMemoryTool } from "./memory-read.js";
export { writeMemoryTool, createWriteMemoryTool } from "./memory-write.js";
export { appendMemoryTool, createAppendMemoryTool } from "./memory-append.js";
export { secretListTool } from "./secret-list.js";
export { secretGetTool } from "./secret-get.js";
export { secretSetTool } from "./secret-set.js";
export { secretDeleteTool } from "./secret-delete.js";

import { bashTool } from "./bash.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { appendFileTool } from "./append-file.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";
import { tempEmailTool } from "./temp-email.js";
import { listMemoryTool } from "./memory-list.js";
import { readMemoryTool } from "./memory-read.js";
import { writeMemoryTool, createWriteMemoryTool } from "./memory-write.js";
import { appendMemoryTool, createAppendMemoryTool } from "./memory-append.js";
import { secretListTool } from "./secret-list.js";
import { secretGetTool } from "./secret-get.js";
import { secretSetTool } from "./secret-set.js";
import { secretDeleteTool } from "./secret-delete.js";
import type { ToolDefinition } from "./types/types.js";

// The set of tools enabled by default in every chat session.
export const defaultTools: ToolDefinition[] = [
  bashTool,
  readFileTool,
  writeFileTool,
  appendFileTool,
  webFetchTool,
  webSearchTool,
  tempEmailTool,
  listMemoryTool,
  readMemoryTool,
  writeMemoryTool,
  appendMemoryTool,
  secretListTool,
  secretGetTool,
  secretSetTool,
  secretDeleteTool,
];

// Returns a copy of defaultTools with write_memory and append_memory stamped
// with the given session ID. Every entry written by the agent will be prefixed
// with [session:<sessionId>] so callers can trace which session produced it.
export function createSessionTools(sessionId: string): ToolDefinition[] {
  return defaultTools.map((tool) => {
    if (tool.name === "write_memory") return createWriteMemoryTool(sessionId);
    if (tool.name === "append_memory") return createAppendMemoryTool(sessionId);
    return tool;
  });
}
