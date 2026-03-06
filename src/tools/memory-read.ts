// tools/memory-read.ts
// --------------------
// Reads a single file from the agent's memory store (.cypherclaw/memory/).
//
// The agent calls list_memory first to discover available files, then
// read_memory(file) to pull the content of whichever files are relevant
// to the current task or conversation.
//
// The `file` argument is a filename (or subdirectory/filename) relative to
// the memory dir. Path traversal outside the memory dir is rejected.
// Output is capped at MAX_OUTPUT_CHARS to stay within context limits.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { resolveMemoryDir } from "./memory-list.js";

const MAX_OUTPUT_CHARS = 20_000;

export const readMemoryTool: ToolDefinition = {
  name: "read_memory",
  description:
    "Read the contents of a file from the agent memory store (.cypherclaw/memory/). " +
    "Provide the file name exactly as returned by list_memory.",

  parameters: {
    type: "object",
    properties: {
      file: {
        type: "string",
        description: "File name to read (as returned by list_memory).",
      },
    },
    required: ["file"],
  },

  async execute(args): Promise<string> {
    const memoryDir = resolveMemoryDir();
    const file = args["file"] as string;
    const filePath = path.resolve(memoryDir, file);

    if (!filePath.startsWith(memoryDir + path.sep) && filePath !== memoryDir) {
      return `Error: "${file}" resolves outside the memory directory.`;
    }

    process.stderr.write(`\x1b[33m[read_memory]\x1b[0m ${filePath}\n`);

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
