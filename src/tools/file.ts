// tools/file.ts
// -------------
// Tools for reading, writing, and appending files on disk.
//
// These complement the bash tool by providing semantic, safe file I/O
// that works even in restricted environments where shell execution is disabled.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";

// --- read_file ---

const MAX_OUTPUT_CHARS = 20_000;

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a file from disk and return them as a string. " +
    "Provide a path relative to the current working directory or an absolute path.",

  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read (relative or absolute).",
      },
    },
    required: ["path"],
  },

  async execute(args): Promise<string> {
    const filePath = path.resolve(args["path"] as string);

    process.stderr.write(`\x1b[33m[read_file]\x1b[0m ${filePath}\n`);

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
        return `Error: file not found: ${filePath}`;
      }
      if (error.code === "EISDIR") {
        return `Error: path is a directory, not a file: ${filePath}`;
      }
      return `Error reading file: ${error.message ?? String(err)}`;
    }
  },
};

// --- write_file ---

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
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return `Written ${content.length} characters to ${filePath}`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error writing file: ${error.message ?? String(err)}`;
    }
  },
};

// --- append_file ---

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
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, content, "utf-8");
      return `Appended ${content.length} characters to ${filePath}`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error appending to file: ${error.message ?? String(err)}`;
    }
  },
};
