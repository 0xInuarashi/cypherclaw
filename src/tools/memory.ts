// tools/memory.ts
// ---------------
// Memory store tools for reading, writing, searching, and managing
// agent memory files across session and global scopes.
//
// Two scopes are available:
//   "session" — scoped to the current session (~/.cypherclaw/memory/sessions/<sessionId>/).
//               Automatically isolated; no cross-session pollution.
//   "global"  — shared across all sessions (~/.cypherclaw/memory/global/).
//               Use for long-term, project-wide knowledge.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { fuzzyScore } from "./utils/fuzzy.js";

const MEMORY_BASE = () => path.join(os.homedir(), ".cypherclaw", "memory");

export function resolveMemoryScope(scope: "session" | "global", sessionId?: string): string {
  if (scope === "global") {
    return path.join(MEMORY_BASE(), "global");
  }
  if (!sessionId) {
    throw new Error("sessionId is required for session-scoped memory.");
  }
  return path.join(MEMORY_BASE(), "sessions", sessionId);
}

// --- list_memory ---

export function createListMemoryTool(sessionId?: string): ToolDefinition {
  return {
    name: "list_memory",
    description:
      "List files in the agent memory store. " +
      "scope=\"session\" lists memory for the current session only (.cypherclaw/memory/sessions/<id>/). " +
      "scope=\"global\" lists long-term memory shared across all sessions (.cypherclaw/memory/global/). " +
      "Call this at session start for both scopes to load relevant context, " +
      "then use read_memory to load specific files.",

    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["session", "global"],
          description: "Memory scope to list. \"session\" for current-session memory; \"global\" for long-term shared memory.",
        },
      },
      required: ["scope"],
    },

    async execute(args): Promise<string> {
      const scope = (args["scope"] as "session" | "global");

      let memoryDir: string;
      try {
        memoryDir = resolveMemoryScope(scope, sessionId);
      } catch (err: unknown) {
        return `Error: ${(err as Error).message}`;
      }

      process.stderr.write(`\x1b[33m[list_memory:${scope}]\x1b[0m ${memoryDir}\n`);

      try {
        const entries = await fs.readdir(memoryDir, { withFileTypes: true });
        const files = entries
          .filter((e) => e.isFile())
          .map((e) => e.name)
          .sort();

        if (files.length === 0) {
          return `(no ${scope} memory files yet)`;
        }

        return files.join("\n");
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (error.code === "ENOENT") {
          return `(no ${scope} memory files yet)`;
        }
        return `Error listing memory: ${error.message ?? String(err)}`;
      }
    },
  };
}

export const listMemoryTool: ToolDefinition = createListMemoryTool();

// --- read_memory ---

const READ_MAX_OUTPUT_CHARS = 20_000;

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

        if (content.length > READ_MAX_OUTPUT_CHARS) {
          return (
            content.slice(0, READ_MAX_OUTPUT_CHARS) +
            `\n\n[file truncated — ${content.length - READ_MAX_OUTPUT_CHARS} chars omitted]`
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

// --- write_memory ---

export function createWriteMemoryTool(sessionId?: string): ToolDefinition {
  return {
    name: "write_memory",
    description:
      "Create or fully overwrite a file in the agent memory store. " +
      "scope=\"session\" writes to current-session memory (isolated, temporary); " +
      "scope=\"global\" writes to long-term shared memory (persists across all sessions). " +
      "Use append_memory when you only want to add new content without replacing what is already there.",

    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["session", "global"],
          description: "Memory scope to write to. Default to \"session\" unless the content is long-term project knowledge.",
        },
        file: {
          type: "string",
          description: "File name to write (e.g. \"notes.md\").",
        },
        content: {
          type: "string",
          description: "The full content to write to the file.",
        },
      },
      required: ["scope", "file", "content"],
    },

    async execute(args): Promise<string> {
      const scope = args["scope"] as "session" | "global";
      const file = args["file"] as string;
      const content = args["content"] as string;

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

      process.stderr.write(`\x1b[33m[write_memory:${scope}]\x1b[0m ${filePath}\n`);

      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
        return `Written ${content.length} characters to ${scope} memory file: ${file}`;
      } catch (err: unknown) {
        const error = err as { message?: string };
        return `Error writing memory file: ${error.message ?? String(err)}`;
      }
    },
  };
}

export const writeMemoryTool: ToolDefinition = createWriteMemoryTool();

// --- append_memory ---

export function createAppendMemoryTool(sessionId?: string): ToolDefinition {
  return {
    name: "append_memory",
    description:
      "Append content to a file in the agent memory store without overwriting existing content. " +
      "Creates the file if it doesn't exist. " +
      "scope=\"session\" appends to current-session memory (isolated, temporary); " +
      "scope=\"global\" appends to long-term shared memory (persists across all sessions). " +
      "Use write_memory to fully replace a file.",

    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["session", "global"],
          description: "Memory scope to append to. Default to \"session\" unless the content is long-term project knowledge.",
        },
        file: {
          type: "string",
          description: "File name to append to (e.g. \"notes.md\").",
        },
        content: {
          type: "string",
          description: "The content to append at the end of the file.",
        },
      },
      required: ["scope", "file", "content"],
    },

    async execute(args): Promise<string> {
      const scope = args["scope"] as "session" | "global";
      const file = args["file"] as string;
      const content = args["content"] as string;

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

      process.stderr.write(`\x1b[33m[append_memory:${scope}]\x1b[0m ${filePath}\n`);

      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, content, "utf-8");
        return `Appended ${content.length} characters to ${scope} memory file: ${file}`;
      } catch (err: unknown) {
        const error = err as { message?: string };
        return `Error appending to memory file: ${error.message ?? String(err)}`;
      }
    },
  };
}

export const appendMemoryTool: ToolDefinition = createAppendMemoryTool();

// --- delete_memory ---

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

// --- search_memory ---

const SEARCH_MAX_RESULTS = 20;
const CONTENT_THRESHOLD = 0.25;
const FILENAME_THRESHOLD = 0.2;
const SNIPPET_CONTEXT_CHARS = 120;

type MemoryHit = {
  file: string;
  scope: "session" | "global";
  matchType: "filename" | "content";
  snippet?: string;
  lineNumber?: number;
  score: number;
};

async function searchScope(
  query: string,
  scope: "session" | "global",
  sessionId?: string,
): Promise<MemoryHit[]> {
  let memoryDir: string;
  try {
    memoryDir = resolveMemoryScope(scope, sessionId);
  } catch {
    return [];
  }

  let entries: string[];
  try {
    const dirents = await fs.readdir(memoryDir, { withFileTypes: true });
    entries = dirents.filter((e) => e.isFile()).map((e) => e.name);
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    throw err;
  }

  const hits: MemoryHit[] = [];

  for (const file of entries) {
    const filenameScore = fuzzyScore(query, file);
    if (filenameScore >= FILENAME_THRESHOLD) {
      hits.push({ file, scope, matchType: "filename", score: filenameScore });
    }

    const filePath = path.join(memoryDir, file);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const lineScore = fuzzyScore(query, line);
      if (lineScore >= CONTENT_THRESHOLD) {
        const snippet =
          line.length > SNIPPET_CONTEXT_CHARS
            ? line.slice(0, SNIPPET_CONTEXT_CHARS) + "…"
            : line;
        hits.push({
          file,
          scope,
          matchType: "content",
          snippet,
          lineNumber: i + 1,
          score: lineScore,
        });
      }
    }
  }

  return hits;
}

export function createSearchMemoryTool(sessionId?: string): ToolDefinition {
  return {
    name: "search_memory",
    description:
      "Fuzzy search across memory files — matches both filenames and file contents. " +
      "Use this to quickly find relevant notes, facts, or past work without knowing the exact filename. " +
      "Returns matching files and lines ranked by similarity score.",

    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query. Fuzzy-matched against filenames and every line of every memory file.",
        },
        scope: {
          type: "string",
          enum: ["session", "global", "all"],
          description: "Memory scope to search. Defaults to \"all\" (searches both session and global memory).",
        },
        maxResults: {
          type: "number",
          description: `Maximum number of results to return. Defaults to ${SEARCH_MAX_RESULTS}.`,
        },
      },
      required: ["query"],
    },

    async execute(args): Promise<string> {
      const query = (args["query"] as string).trim();
      const scope = (args["scope"] as "session" | "global" | "all" | undefined) ?? "all";
      const maxResults = (args["maxResults"] as number | undefined) ?? SEARCH_MAX_RESULTS;

      if (!query) return "Error: query must not be empty.";

      process.stderr.write(`\x1b[33m[search_memory:${scope}]\x1b[0m ${query}\n`);

      const scopes: Array<"session" | "global"> =
        scope === "all" ? ["session", "global"] : [scope];

      const allHits: MemoryHit[] = [];
      for (const s of scopes) {
        const hits = await searchScope(query, s, sessionId);
        allHits.push(...hits);
      }

      if (allHits.length === 0) {
        return "No memory files matched your query.";
      }

      const ranked = allHits
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      const lines = ranked.map((hit) => {
        const loc =
          hit.matchType === "filename"
            ? `[${hit.scope}] ${hit.file} (filename match, score ${hit.score.toFixed(2)})`
            : `[${hit.scope}] ${hit.file}:${hit.lineNumber} (score ${hit.score.toFixed(2)}) — ${hit.snippet}`;
        return loc;
      });

      return lines.join("\n");
    },
  };
}

export const searchMemoryTool: ToolDefinition = createSearchMemoryTool();
