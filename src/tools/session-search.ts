// tools/session-search.ts
// -----------------------
// Fuzzy search across all saved session transcripts.
//
// Searches message content in every session JSONL file and returns the
// session names ranked by relevance — so the agent can identify which past
// sessions are worth reading without loading every transcript up front.
//
// Results include:
//   - session: the session name (pass to read_session to load the full transcript)
//   - score: best fuzzy match score found across all messages in that session
//   - snippet: the matching message excerpt
//   - role: "user" or "assistant" — whose message matched

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { resolveSessionsDir } from "../sessions/store.js";
import { fuzzyScore } from "./utils/fuzzy.js";

const MAX_RESULTS = 20;
const CONTENT_THRESHOLD = 0.25;
const SNIPPET_CONTEXT_CHARS = 120;

type SessionHit = {
  session: string;
  score: number;
  role: "user" | "assistant";
  snippet: string;
};

async function searchSessions(query: string): Promise<SessionHit[]> {
  const dir = await resolveSessionsDir();

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    throw err;
  }

  const sessionFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith(".jsonl") && !e.name.endsWith(".tokens.jsonl"),
  );

  const bestPerSession = new Map<string, SessionHit>();

  await Promise.all(
    sessionFiles.map(async (entry) => {
      const sessionName = entry.name.slice(0, -6);
      const filePath = path.join(dir, entry.name);

      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf-8");
      } catch {
        return;
      }

      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: { role?: string; content?: string };
        try {
          parsed = JSON.parse(trimmed) as { role?: string; content?: string };
        } catch {
          continue;
        }

        if (
          (parsed.role !== "user" && parsed.role !== "assistant") ||
          typeof parsed.content !== "string"
        ) {
          continue;
        }

        const score = fuzzyScore(query, parsed.content);
        if (score < CONTENT_THRESHOLD) continue;

        const existing = bestPerSession.get(sessionName);
        if (!existing || score > existing.score) {
          const content = parsed.content;
          const snippet =
            content.length > SNIPPET_CONTEXT_CHARS
              ? content.slice(0, SNIPPET_CONTEXT_CHARS) + "…"
              : content;
          bestPerSession.set(sessionName, {
            session: sessionName,
            score,
            role: parsed.role as "user" | "assistant",
            snippet,
          });
        }
      }
    }),
  );

  return [...bestPerSession.values()].sort((a, b) => b.score - a.score);
}

export const sessionSearchTool: ToolDefinition = {
  name: "search_sessions",
  description:
    "Fuzzy search across all saved session transcripts. " +
    "Returns a ranked list of session names whose conversation content matches the query. " +
    "Use this to find relevant past sessions before calling read_session to load the full transcript.",

  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query. Fuzzy-matched against every message in every session transcript.",
      },
      maxResults: {
        type: "number",
        description: `Maximum number of sessions to return. Defaults to ${MAX_RESULTS}.`,
      },
    },
    required: ["query"],
  },

  async execute(args): Promise<string> {
    const query = (args["query"] as string).trim();
    const maxResults = (args["maxResults"] as number | undefined) ?? MAX_RESULTS;

    if (!query) return "Error: query must not be empty.";

    process.stderr.write(`\x1b[33m[search_sessions]\x1b[0m ${query}\n`);

    const hits = await searchSessions(query);

    if (hits.length === 0) {
      return "No sessions matched your query.";
    }

    const ranked = hits.slice(0, maxResults);

    const lines = ranked.map((hit) =>
      `${hit.session}  (score ${hit.score.toFixed(2)}, ${hit.role}) — ${hit.snippet}`,
    );

    return lines.join("\n");
  },
};
