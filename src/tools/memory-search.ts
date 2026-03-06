// tools/memory-search.ts
// ----------------------
// Fuzzy search across all memory files (filenames + contents).
//
// Uses trigram-based fuzzy scoring so partial/approximate queries still match.
// Searches both session and global memory by default (scope="all"),
// or either individually.
//
// Results are sorted by score descending. Each result includes:
//   - file: the filename
//   - scope: "session" or "global"
//   - matchType: "filename" | "content"
//   - snippet: the matching line (for content hits)
//   - lineNumber: 1-based line number (for content hits)
//   - score: 0–1 fuzzy similarity

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { resolveMemoryScope } from "./memory-list.js";
import { fuzzyScore } from "./utils/fuzzy.js";

const MAX_RESULTS = 20;
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
          description: `Maximum number of results to return. Defaults to ${MAX_RESULTS}.`,
        },
      },
      required: ["query"],
    },

    async execute(args): Promise<string> {
      const query = (args["query"] as string).trim();
      const scope = (args["scope"] as "session" | "global" | "all" | undefined) ?? "all";
      const maxResults = (args["maxResults"] as number | undefined) ?? MAX_RESULTS;

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
