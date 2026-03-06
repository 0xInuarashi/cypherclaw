// tools/memory-delete.ts
// -----------------------
// Deletes a file from global memory (.cypherclaw/memory/global/).
//
// Global memory accumulates over time and can become stale. Use this tool to
// prune entries that are no longer accurate or relevant — outdated project
// facts, resolved issues, expired credentials, superseded decisions, etc.
//
// Only global memory can be deleted. Session memory is naturally bounded and
// does not require manual cleanup.
//
// Path traversal outside the global memory directory is rejected.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { resolveMemoryScope } from "./memory-list.js";

export const deleteMemoryTool: ToolDefinition = {
  name: "delete_memory",
  description:
    "Delete a file from global memory (.cypherclaw/memory/global/) to remove stale or outdated entries. " +
    "Use this when global memory is no longer accurate — outdated facts, resolved issues, superseded decisions, etc. " +
    "Only global memory can be deleted. Session memory is automatically bounded and does not need manual cleanup.",

  parameters: {
    type: "object",
    properties: {
      file: {
        type: "string",
        description: "File name to delete from global memory (as returned by list_memory with scope=\"global\").",
      },
    },
    required: ["file"],
  },

  async execute(args): Promise<string> {
    const file = args["file"] as string;
    const memoryDir = resolveMemoryScope("global");
    const filePath = path.resolve(memoryDir, file);

    if (!filePath.startsWith(memoryDir + path.sep) && filePath !== memoryDir) {
      return `Error: "${file}" resolves outside the global memory directory.`;
    }

    process.stderr.write(`\x1b[33m[delete_memory:global]\x1b[0m ${filePath}\n`);

    try {
      await fs.unlink(filePath);
      return `Deleted global memory file: ${file}`;
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === "ENOENT") {
        return `Error: global memory file not found: ${file}`;
      }
      return `Error deleting memory file: ${error.message ?? String(err)}`;
    }
  },
};
