// tools/read-file.ts
// -------------------
// A tool that lets the LLM read the contents of a file from disk.
//
// Why have this when the bash tool can already `cat` a file?
//   1. Semantic clarity — the model knows this is a dedicated "read file"
//      operation, not a general shell command. It's less likely to misuse it.
//   2. Safer on restricted environments where bash execution may be disabled.
//   3. Direct file I/O is slightly more reliable than spawning a subprocess.
//
// Output is capped at MAX_OUTPUT_CHARS to keep it within context limits.
// Binary files return an error rather than garbled output.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";

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
