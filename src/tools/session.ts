// tools/session.ts
// ----------------
// Tools for listing, reading, and searching saved session transcripts
// stored in ~/.cypherclaw/sessions/.
//
// Use list_sessions to discover past sessions, search_sessions to find
// relevant ones by content, and read_session to load a full transcript
// for cross-session context.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";
import { listSessions, loadSession, resolveSessionsDir } from "../sessions/store.js";
import { fuzzyScore } from "./utils/fuzzy.js";

// --- list_sessions ---

const PAGE_SIZE = 100;

export const sessionListTool: ToolDefinition = {
  name: "list_sessions",
  description:
    "List saved sessions in .cypherclaw/sessions/, sorted by most recently updated. " +
    "Returns session names, message counts, and last-updated timestamps. " +
    `Results are paginated (${PAGE_SIZE} per page) — use the page parameter to fetch further pages. ` +
    "Use read_session to load the full conversation history of a specific session.",

  parameters: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description: `Page number to retrieve (1-based, ${PAGE_SIZE} sessions per page). Defaults to 1.`,
      },
    },
    required: [],
  },

  async execute(args): Promise<string> {
    const page = Math.max(1, Math.floor((args["page"] as number | undefined ?? 1)));
    const offset = (page - 1) * PAGE_SIZE;

    process.stderr.write(`\x1b[33m[list_sessions]\x1b[0m page=${page}\n`);

    const all = await listSessions();

    if (all.length === 0) {
      return "(no sessions found)";
    }

    const totalPages = Math.ceil(all.length / PAGE_SIZE);
    const slice = all.slice(offset, offset + PAGE_SIZE);

    if (slice.length === 0) {
      return `Page ${page} is out of range. Total pages: ${totalPages}.`;
    }

    const lines = slice.map((s) => {
      const updated = s.updatedAt.toISOString();
      return `${s.name}  (${s.messageCount} messages, updated ${updated})`;
    });

    const footer = totalPages > 1
      ? `\n\nPage ${page} of ${totalPages} (${all.length} total sessions).`
      : "";

    return lines.join("\n") + footer;
  },
};

// --- read_session ---

const MAX_OUTPUT_CHARS = 40_000;
const MAX_HISTORY_TURNS = 200;

export const sessionReadTool: ToolDefinition = {
  name: "read_session",
  description:
    "Read the conversation history of a saved session by name. " +
    "Use list_sessions first to discover available session names. " +
    "Returns a formatted transcript of the session's messages for cross-session context.",

  parameters: {
    type: "object",
    properties: {
      session: {
        type: "string",
        description: "Session name to read (as returned by list_sessions).",
      },
    },
    required: ["session"],
  },

  async execute(args): Promise<string> {
    const session = args["session"] as string;

    process.stderr.write(`\x1b[33m[read_session]\x1b[0m ${session}\n`);

    const messages = await loadSession(session, MAX_HISTORY_TURNS);

    if (messages === null) {
      return `Error: session not found: ${session}`;
    }

    if (messages.length === 0) {
      return "(session exists but has no messages)";
    }

    const lines: string[] = [];
    for (const msg of messages) {
      const label = msg.role === "user" ? "USER" : "ASSISTANT";
      lines.push(`[${label}]\n${msg.content}`);
    }

    const transcript = lines.join("\n\n---\n\n");

    if (transcript.length > MAX_OUTPUT_CHARS) {
      return (
        transcript.slice(0, MAX_OUTPUT_CHARS) +
        `\n\n[transcript truncated — ${transcript.length - MAX_OUTPUT_CHARS} chars omitted]`
      );
    }

    return transcript;
  },
};

// --- search_sessions ---

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
