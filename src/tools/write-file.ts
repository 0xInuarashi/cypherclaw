// tools/write-file.ts
// --------------------
// A tool that lets the LLM write (create or overwrite) a file on disk.
//
// This is intentionally a full overwrite rather than an append or patch:
//   - It's the simplest mental model for the agent ("here is the entire file").
//   - Partial edits via text are error-prone; overwriting the whole file is
//     reliable as long as the model has seen the current contents first.
//   - If the model needs to append, it can read the file first, then write
//     the combined content back.
//
// Intermediate directories are created automatically so the model doesn't need
// to worry about mkdir.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "Write content to a file on disk, creating it if it doesn't exist or " +
    "overwriting it if it does. Parent directories are created automatically. " +
    "Provide a path relative to the current working directory or an absolute path.",

  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to write (relative or absolute).",
      },
      content: {
        type: "string",
        description: "The full content to write to the file.",
      },
    },
    required: ["path", "content"],
  },

  async execute(args): Promise<string> {
    const filePath = path.resolve(args["path"] as string);
    const content = args["content"] as string;

    process.stderr.write(`\x1b[33m[write_file]\x1b[0m ${filePath}\n`);

    try {
      // Ensure parent directories exist before writing.
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return `Written ${content.length} characters to ${filePath}`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error writing file: ${error.message ?? String(err)}`;
    }
  },
};
