// tools/guide-read.ts
// -------------------
// Provides access to the built-in guides bundled with CypherClaw.
//
// Three tools are exported:
//   list_guides   — lists all available guides with their title and filename.
//   read_guide    — reads the full contents of a guide by filename.
//   search_guides — fuzzy search across guide filenames and contents.
//
// Guides live in src/guides/ (or dist/guides/ when built) and are resolved
// relative to this file using import.meta.url so the path works in both
// dev (tsx) and production (node dist/).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "./types/types.js";
import { fuzzyScore } from "./utils/fuzzy.js";

const GUIDES_DIR = path.resolve(fileURLToPath(import.meta.url), "../../guides");

async function listGuideFiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(GUIDES_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    throw err;
  }
}

async function extractTitle(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
    }
    return null;
  } catch {
    return null;
  }
}

export const listGuidesTool: ToolDefinition = {
  name: "list_guides",
  description:
    "List all built-in guides available in CypherClaw. " +
    "Returns each guide's filename and title. " +
    "Call this when receiving a user request to check whether a relevant guide exists, " +
    "then use read_guide to read it if applicable.",

  parameters: {
    type: "object",
    properties: {},
    required: [],
  },

  async execute(): Promise<string> {
    process.stderr.write(`\x1b[33m[list_guides]\x1b[0m ${GUIDES_DIR}\n`);

    const files = await listGuideFiles();

    if (files.length === 0) {
      return "(no guides available)";
    }

    const lines: string[] = [];
    for (const file of files) {
      const title = await extractTitle(path.join(GUIDES_DIR, file));
      lines.push(title ? `${file} — ${title}` : file);
    }

    return lines.join("\n");
  },
};

export const readGuideTool: ToolDefinition = {
  name: "read_guide",
  description:
    "Read the full contents of a built-in CypherClaw guide by filename. " +
    "Use list_guides first to discover available guides and their filenames.",

  parameters: {
    type: "object",
    properties: {
      file: {
        type: "string",
        description: "Guide filename to read (e.g. \"install-discord-connector.md\"), as returned by list_guides.",
      },
    },
    required: ["file"],
  },

  async execute(args): Promise<string> {
    const file = args["file"] as string;

    const filePath = path.resolve(GUIDES_DIR, file);
    if (!filePath.startsWith(GUIDES_DIR + path.sep) && filePath !== GUIDES_DIR) {
      return `Error: "${file}" resolves outside the guides directory.`;
    }

    process.stderr.write(`\x1b[33m[read_guide]\x1b[0m ${filePath}\n`);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return content || "(empty guide)";
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === "ENOENT") {
        return `Error: guide not found: "${file}". Use list_guides to see available guides.`;
      }
      return `Error reading guide: ${error.message ?? String(err)}`;
    }
  },
};

const SEARCH_MAX_RESULTS = 20;
const SEARCH_CONTENT_THRESHOLD = 0.25;
const SEARCH_FILENAME_THRESHOLD = 0.2;
const SEARCH_SNIPPET_CHARS = 120;

type GuideHit = {
  file: string;
  matchType: "filename" | "content";
  snippet?: string;
  lineNumber?: number;
  score: number;
};

export const searchGuidesTool: ToolDefinition = {
  name: "search_guides",
  description:
    "Fuzzy search across built-in CypherClaw guides — matches both filenames and guide contents. " +
    "Use this to quickly find relevant guides without knowing the exact filename. " +
    "Returns matching guides and lines ranked by similarity score.",

  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query. Fuzzy-matched against filenames and every line of every guide.",
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
    const maxResults = (args["maxResults"] as number | undefined) ?? SEARCH_MAX_RESULTS;

    if (!query) return "Error: query must not be empty.";

    process.stderr.write(`\x1b[33m[search_guides]\x1b[0m ${query}\n`);

    const files = await listGuideFiles();
    const hits: GuideHit[] = [];

    for (const file of files) {
      const filenameScore = fuzzyScore(query, file);
      if (filenameScore >= SEARCH_FILENAME_THRESHOLD) {
        hits.push({ file, matchType: "filename", score: filenameScore });
      }

      let content: string;
      try {
        content = await fs.readFile(path.join(GUIDES_DIR, file), "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const lineScore = fuzzyScore(query, line);
        if (lineScore >= SEARCH_CONTENT_THRESHOLD) {
          const snippet =
            line.length > SEARCH_SNIPPET_CHARS
              ? line.slice(0, SEARCH_SNIPPET_CHARS) + "…"
              : line;
          hits.push({ file, matchType: "content", snippet, lineNumber: i + 1, score: lineScore });
        }
      }
    }

    if (hits.length === 0) {
      return "No guides matched your query.";
    }

    const ranked = hits.sort((a, b) => b.score - a.score).slice(0, maxResults);

    return ranked
      .map((hit) =>
        hit.matchType === "filename"
          ? `${hit.file} (filename match, score ${hit.score.toFixed(2)})`
          : `${hit.file}:${hit.lineNumber} (score ${hit.score.toFixed(2)}) — ${hit.snippet}`,
      )
      .join("\n");
  },
};
