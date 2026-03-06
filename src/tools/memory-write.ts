// tools/memory-write.ts
// ----------------------
// Creates or fully overwrites a file in the agent's memory store.
//
// Two scopes are available:
//   "session" — writes to the current session's memory (.cypherclaw/memory/sessions/<id>/).
//               Isolated per session; no cross-session pollution.
//   "global"  — writes to long-term shared memory (.cypherclaw/memory/global/).
//               Persists across all sessions. Use for project-wide facts and preferences.
//
// Use write_memory when consolidating or replacing an existing memory file
// with updated content. For adding new entries without touching existing
// content, use append_memory instead.
//
// Path traversal outside the scoped directory is rejected.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { resolveMemoryScope } from "./memory-list.js";

export function createWriteMemoryTool(sessionId?: string): ToolDefinition {
  return {
    name: "write_memory",
    description:
      "Create or fully overwrite a file in the agent memory store. " +
      "scope=\"session\" writes to current-session memory (isolated, temporary); " +
      "scope=\"global\" writes to long-term shared memory (persists across all sessions). " +
      "Use append_memory when you only want to add new content without replacing what is already there.",

    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["session", "global"],
          description: "Memory scope to write to. Default to \"session\" unless the content is long-term project knowledge.",
        },
        file: {
          type: "string",
          description: "File name to write (e.g. \"notes.md\").",
        },
        content: {
          type: "string",
          description: "The full content to write to the file.",
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

      process.stderr.write(`\x1b[33m[write_memory:${scope}]\x1b[0m ${filePath}\n`);

      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
        return `Written ${content.length} characters to ${scope} memory file: ${file}`;
      } catch (err: unknown) {
        const error = err as { message?: string };
        return `Error writing memory file: ${error.message ?? String(err)}`;
      }
    },
  };
}

export const writeMemoryTool: ToolDefinition = createWriteMemoryTool();
