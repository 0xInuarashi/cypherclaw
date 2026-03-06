// tools/memory-list.ts
// --------------------
// Lists all files in the agent's memory store (.cypherclaw/memory/).
//
// This is the entry point for memory-aware behaviour: the agent calls
// list_memory at the start of a session to discover what it has remembered,
// then uses read_memory to pull the relevant files into context.
//
// Storage: <cwd>/.cypherclaw/memory/
// Returns a newline-separated list of file names (relative to the memory dir).
// Returns an empty message if no memory files exist yet.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";

export function resolveMemoryDir(): string {
  return path.join(process.cwd(), ".cypherclaw", "memory");
}

export const listMemoryTool: ToolDefinition = {
  name: "list_memory",
  description:
    "List all files in the agent memory store (.cypherclaw/memory/). " +
    "Call this at the start of a session to discover what has been remembered, " +
    "then use read_memory to load relevant files.",

  parameters: {
    type: "object",
    properties: {},
    required: [],
  },

  async execute(): Promise<string> {
    const memoryDir = resolveMemoryDir();

    process.stderr.write(`\x1b[33m[list_memory]\x1b[0m ${memoryDir}\n`);

    try {
      const entries = await fs.readdir(memoryDir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();

      if (files.length === 0) {
        return "(no memory files yet)";
      }

      return files.join("\n");
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === "ENOENT") {
        return "(no memory files yet)";
      }
      return `Error listing memory: ${error.message ?? String(err)}`;
    }
  },
};
