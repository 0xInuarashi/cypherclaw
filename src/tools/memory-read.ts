// tools/memory-read.ts
// --------------------
// Reads a single file from the agent's memory store.
//
// Two scopes are available:
//   "session" — reads from the current session's memory (.cypherclaw/memory/sessions/<id>/).
//   "global"  — reads from long-term shared memory (.cypherclaw/memory/global/).
//
// The `file` argument is a filename relative to the scoped directory.
// Path traversal outside the scoped dir is rejected.
// Output is capped at MAX_OUTPUT_CHARS to stay within context limits.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { resolveMemoryScope } from "./memory-list.js";

const MAX_OUTPUT_CHARS = 20_000;

export function createReadMemoryTool(sessionId?: string): ToolDefinition {
  return {
    name: "read_memory",
    description:
      "Read the contents of a file from the agent memory store. " +
      "scope=\"session\" reads from current-session memory; scope=\"global\" reads from long-term shared memory. " +
      "Provide the file name exactly as returned by list_memory.",

    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["session", "global"],
          description: "Memory scope to read from.",
        },
        file: {
          type: "string",
          description: "File name to read (as returned by list_memory).",
        },
      },
      required: ["scope", "file"],
    },

    async execute(args): Promise<string> {
      const scope = args["scope"] as "session" | "global";
      const file = args["file"] as string;

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

      process.stderr.write(`\x1b[33m[read_memory:${scope}]\x1b[0m ${filePath}\n`);

      try {
        const content = await fs.readFile(filePath, "utf-8");

        if (content.length > MAX_OUTPUT_CHARS) {
          return (
            content.slice(0, MAX_OUTPUT_CHARS) +
            `\n\n[file truncated — ${content.length - MAX_OUTPUT_CHARS} chars omitted]`
          );
        }

        return content || "(empty file)";
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (error.code === "ENOENT") {
          return `Error: memory file not found: ${file}`;
        }
        return `Error reading memory file: ${error.message ?? String(err)}`;
      }
    },
  };
}

export const readMemoryTool: ToolDefinition = createReadMemoryTool();
