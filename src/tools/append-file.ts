// tools/append-file.ts
// ---------------------
// A tool that lets the LLM append content to an existing file without
// touching what's already there.
//
// Why this exists alongside write_file:
//   write_file always overwrites the entire file. That's reliable when the
//   model has read the current contents and is rewriting the whole thing, but
//   it's dangerous when the goal is just to add new content at the end —
//   a single mistake or truncated output could silently erase existing data.
//
//   append_file removes that risk entirely: the model only supplies the new
//   content to add. Whatever was in the file before is untouched.
//
// Typical use cases:
//   - Adding a new log entry or record to an existing file.
//   - Extending a file with new lines (e.g. adding to a .gitignore).
//   - Writing output incrementally without re-reading the whole file first.
//
// The file is created if it doesn't exist yet (same as write_file).
// Parent directories are created automatically.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

export const appendFileTool: ToolDefinition = {
  name: "append_file",
  description:
    "Append content to the end of a file without overwriting existing content. " +
    "Creates the file if it doesn't exist. Parent directories are created automatically. " +
    "Use this instead of write_file when you only want to add new content and must " +
    "not touch what is already in the file.",

  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to append to (relative or absolute).",
      },
      content: {
        type: "string",
        description: "The content to append at the end of the file.",
      },
    },
    required: ["path", "content"],
  },

  async execute(args): Promise<string> {
    const filePath = path.resolve(args["path"] as string);
    const content = args["content"] as string;

    process.stderr.write(`\x1b[33m[append_file]\x1b[0m ${filePath}\n`);

    try {
      // Ensure parent directories exist before appending.
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, content, "utf-8");
      return `Appended ${content.length} characters to ${filePath}`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error appending to file: ${error.message ?? String(err)}`;
    }
  },
};
