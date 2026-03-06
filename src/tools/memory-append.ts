// tools/memory-append.ts
// -----------------------
// Appends content to a file in the agent's memory store without touching
// existing content.
//
// Two scopes are available:
//   "session" — appends to the current session's memory (.cypherclaw/memory/sessions/<id>/).
//   "global"  — appends to long-term shared memory (.cypherclaw/memory/global/).
//
// Use this for incremental updates — adding a new note, log entry, or
// observation to an existing memory file. Use write_memory when you need
// to consolidate and replace the whole file.
//
// The file (and scoped dir) are created automatically if they don't exist.
// Path traversal outside the scoped directory is rejected.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { resolveMemoryScope } from "./memory-list.js";

export function createAppendMemoryTool(sessionId?: string): ToolDefinition {
  return {
    name: "append_memory",
    description:
      "Append content to a file in the agent memory store without overwriting existing content. " +
      "Creates the file if it doesn't exist. " +
      "scope=\"session\" appends to current-session memory (isolated, temporary); " +
      "scope=\"global\" appends to long-term shared memory (persists across all sessions). " +
      "Use write_memory to fully replace a file.",

    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["session", "global"],
          description: "Memory scope to append to. Default to \"session\" unless the content is long-term project knowledge.",
        },
        file: {
          type: "string",
          description: "File name to append to (e.g. \"notes.md\").",
        },
        content: {
          type: "string",
          description: "The content to append at the end of the file.",
        },
      },
      required: ["scope", "file", "content"],
    },

    async execute(args): Promise<string> {
      const scope = args["scope"] as "session" | "global";
      const file = args["file"] as string;
      const content = args["content"] as string;

      let memoryDir: string;
      try {
        memoryDir = resolveMemoryScope(scope, sessionId);
      } catch (err: unknown) {
        return `Error: ${(err as Error).message}`;
      }

      const filePath = path.resolve(memoryDir, file);
      if (!filePath.startsWith(memoryDir + path.sep) && filePath !== memoryDir) {
        return `Error: "${file}" resolves outside the memory directory.`;
      }

      process.stderr.write(`\x1b[33m[append_memory:${scope}]\x1b[0m ${filePath}\n`);

      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, content, "utf-8");
        return `Appended ${content.length} characters to ${scope} memory file: ${file}`;
      } catch (err: unknown) {
        const error = err as { message?: string };
        return `Error appending to memory file: ${error.message ?? String(err)}`;
      }
    },
  };
}

export const appendMemoryTool: ToolDefinition = createAppendMemoryTool();
