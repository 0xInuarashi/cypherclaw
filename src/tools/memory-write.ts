// tools/memory-write.ts
// ----------------------
// Creates or fully overwrites a file in the agent's memory store
// (.cypherclaw/memory/).
//
// Use write_memory when consolidating or replacing an existing memory file
// with updated content. For adding new entries without touching existing
// content, use append_memory instead.
//
// The memory dir is created automatically if it doesn't exist yet.
// Path traversal outside the memory dir is rejected.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { resolveMemoryDir } from "./memory-list.js";

export const writeMemoryTool: ToolDefinition = {
  name: "write_memory",
  description:
    "Create or fully overwrite a file in the agent memory store (.cypherclaw/memory/). " +
    "Use this to save or consolidate memories. " +
    "Use append_memory instead when you only want to add new content without touching what is already there.",

  parameters: {
    type: "object",
    properties: {
      file: {
        type: "string",
        description: "File name to write (e.g. \"notes.md\").",
      },
      content: {
        type: "string",
        description: "The full content to write to the file.",
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

    process.stderr.write(`\x1b[33m[write_memory]\x1b[0m ${filePath}\n`);

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return `Written ${content.length} characters to memory file: ${file}`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error writing memory file: ${error.message ?? String(err)}`;
    }
  },
};
