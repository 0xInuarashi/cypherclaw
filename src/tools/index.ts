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
//   list_memory   — List files in session or global memory store.
//   read_memory   — Read a file from session or global memory store.
//   write_memory  — Write (create/overwrite) a file in session or global memory store.
//   append_memory — Append content to a file in session or global memory store.
//   delete_memory — Delete a stale file from global memory.
//   search_memory — Fuzzy search across memory filenames and contents.
//   list_secrets  — List names of stored secrets (values never revealed).
//   get_secret    — Retrieve a secret value by name.
//   set_secret        — Store a named secret in the encrypted secrets store (fails if already exists).
//   overwrite_secret  — Replace the value of an existing named secret.
//   delete_secret     — Remove a named secret from the secrets store.
//   list_sessions — List all saved sessions with message counts and timestamps.
//   read_session  — Read the full conversation history of a past session.
//   list_guides   — List built-in guides (filename + title) to check for relevant setup instructions.
//   read_guide    — Read the full contents of a built-in guide by filename.
//   list_skills          — List AgentSkills-format skills (name + description) available in CypherClaw.
//   search_skill         — Fuzzy search for skills by name.
//   read_skill           — Read a skill's SKILL.md and manifest of bundled files.
//   list_experience   — List agent experience entries (techniques discovered during tasks).
//   write_experience  — Create or overwrite an experience entry.
//   append_experience — Append new findings to an existing experience entry.
//   search_experience — Fuzzy search across experience entry names and content.
//   delete_experience — Delete an outdated or superseded experience entry.
//   tts                  — Convert text to speech via Edge's read-aloud service (no API key required).

export type { ToolDefinition } from "./types/types.js";
export { bashTool, createBashTool } from "./bash.js";
export { readFileTool } from "./read-file.js";
export { writeFileTool } from "./write-file.js";
export { appendFileTool } from "./append-file.js";
export { webFetchTool } from "./web-fetch.js";
export { webSearchTool } from "./web-search.js";
export { tempEmailTool } from "./temp-email.js";
export { listMemoryTool, createListMemoryTool } from "./memory-list.js";
export { readMemoryTool, createReadMemoryTool } from "./memory-read.js";
export { writeMemoryTool, createWriteMemoryTool } from "./memory-write.js";
export { appendMemoryTool, createAppendMemoryTool } from "./memory-append.js";
export { deleteMemoryTool } from "./memory-delete.js";
export { searchMemoryTool, createSearchMemoryTool } from "./memory-search.js";
export { secretListTool } from "./secret-list.js";
export { secretGetTool } from "./secret-get.js";
export { secretSetTool } from "./secret-set.js";
export { secretOverwriteTool } from "./secret-overwrite.js";
export { secretDeleteTool } from "./secret-delete.js";
export { sessionListTool } from "./session-list.js";
export { sessionReadTool } from "./session-read.js";
export { listGuidesTool, readGuideTool } from "./guide-read.js";
export { listSkillsTool, searchSkillTool, readSkillTool } from "./skill-read.js";
export {
  listExperienceTool,
  writeExperienceTool,
  appendExperienceTool,
  searchExperienceTool,
  deleteExperienceTool,
} from "./experience.js";
export { ttsTool } from "./tts.js";

import { bashTool, createBashTool } from "./bash.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { appendFileTool } from "./append-file.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";
import { tempEmailTool } from "./temp-email.js";
import { listMemoryTool, createListMemoryTool } from "./memory-list.js";
import { readMemoryTool, createReadMemoryTool } from "./memory-read.js";
import { writeMemoryTool, createWriteMemoryTool } from "./memory-write.js";
import { appendMemoryTool, createAppendMemoryTool } from "./memory-append.js";
import { deleteMemoryTool } from "./memory-delete.js";
import { searchMemoryTool, createSearchMemoryTool } from "./memory-search.js";
import { secretListTool } from "./secret-list.js";
import { secretGetTool } from "./secret-get.js";
import { secretSetTool } from "./secret-set.js";
import { secretOverwriteTool } from "./secret-overwrite.js";
import { secretDeleteTool } from "./secret-delete.js";
import { sessionListTool } from "./session-list.js";
import { sessionReadTool } from "./session-read.js";
import { listGuidesTool, readGuideTool } from "./guide-read.js";
import { listSkillsTool, searchSkillTool, readSkillTool } from "./skill-read.js";
import {
  listExperienceTool,
  writeExperienceTool,
  appendExperienceTool,
  searchExperienceTool,
  deleteExperienceTool,
} from "./experience.js";
import { ttsTool } from "./tts.js";
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
  deleteMemoryTool,
  searchMemoryTool,
  secretListTool,
  secretGetTool,
  secretSetTool,
  secretOverwriteTool,
  secretDeleteTool,
  sessionListTool,
  sessionReadTool,
  listGuidesTool,
  readGuideTool,
  listSkillsTool,
  searchSkillTool,
  readSkillTool,
  listExperienceTool,
  writeExperienceTool,
  appendExperienceTool,
  searchExperienceTool,
  deleteExperienceTool,
  ttsTool,
];

// Returns a copy of defaultTools with all memory tools stamped with the given
// session ID so they resolve to the correct scoped directories at runtime.
export function createSessionTools(sessionId: string): ToolDefinition[] {
  return defaultTools.map((tool) => {
    if (tool.name === "bash")         return createBashTool(sessionId);
    if (tool.name === "list_memory")  return createListMemoryTool(sessionId);
    if (tool.name === "read_memory")  return createReadMemoryTool(sessionId);
    if (tool.name === "write_memory") return createWriteMemoryTool(sessionId);
    if (tool.name === "append_memory") return createAppendMemoryTool(sessionId);
    if (tool.name === "search_memory") return createSearchMemoryTool(sessionId);
    return tool;
  });
}
