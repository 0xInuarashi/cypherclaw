// tools/memory-append.ts
// -----------------------
// Appends content to a file in the agent's memory store (.cypherclaw/memory/)
// without touching existing content.
//
// Use this for incremental updates — adding a new note, log entry, or
// observation to an existing memory file. Use write_memory when you need
// to consolidate and replace the whole file.
//
// The file (and memory dir) are created automatically if they don't exist.
// Path traversal outside the memory dir is rejected.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { resolveMemoryDir } from "./memory-list.js";

export const appendMemoryTool: ToolDefinition = {
  name: "append_memory",
  description:
    "Append content to a file in the agent memory store (.cypherclaw/memory/) " +
    "without overwriting existing content. Creates the file if it doesn't exist. " +
    "Use this for incremental updates. Use write_memory to fully replace a file.",

  parameters: {
    type: "object",
    properties: {
      file: {
        type: "string",
        description: "File name to append to (e.g. \"notes.md\").",
      },
      content: {
        type: "string",
        description: "The content to append at the end of the file.",
      },
    },
    required: ["file", "content"],
  },

  async execute(args): Promise<string> {
    const memoryDir = resolveMemoryDir();
    const file = args["file"] as string;
    const content = args["content"] as string;
    const filePath = path.resolve(memoryDir, file);

    if (!filePath.startsWith(memoryDir + path.sep) && filePath !== memoryDir) {
      return `Error: "${file}" resolves outside the memory directory.`;
    }

    process.stderr.write(`\x1b[33m[append_memory]\x1b[0m ${filePath}\n`);

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, content, "utf-8");
      return `Appended ${content.length} characters to memory file: ${file}`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error appending to memory file: ${error.message ?? String(err)}`;
    }
  },
};
