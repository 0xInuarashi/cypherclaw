// sessions/store.ts
// -----------------
// All disk I/O for named conversation sessions.
//
// Format: JSONL (JSON Lines) — one message per line, e.g.:
//   {"role":"user","content":"hello"}
//   {"role":"assistant","content":"hi there"}
//
// Why JSONL instead of a JSON array?
//   We only ever APPEND new messages (never rewrite the full file). JSONL
//   makes that trivial: one fs.appendFile per turn. A JSON array would
//   require rewriting the entire file on every save.
//
// Storage location: ~/.cypherclaw/sessions/<name>.jsonl
//
// Rolling window:
//   On load we apply a configurable history limit (default: 50 turns).
//   One "turn" = one user message + one assistant reply = 2 messages.
//   The full file is never truncated — it is the permanent archive. The
//   window only controls how much is loaded into the working context, so
//   very long sessions don't overflow the model's context window.
//
// Tool schemas are naturally absent: our Message type only contains
// { role, content }. The tool definitions sent to providers are separate
// and ephemeral — they are never part of the conversation history.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Message, TokenUsage } from "../providers/types.js";
import { zeroUsage, addUsage } from "../providers/types.js";

// Default rolling window: last 50 turns (= 100 messages).
export const DEFAULT_HISTORY_LIMIT = 50;

// Session names must be filesystem-safe: letters, numbers, dashes,
// underscores, and dots; 1–128 characters; must start with a letter or number.
const SAFE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export function validateSessionName(name: string): string {
  const trimmed = name.trim();
  if (!SAFE_NAME_RE.test(trimmed)) {
    throw new Error(
      `Invalid session name "${name}". ` +
        `Use only letters, numbers, dashes, underscores, and dots (max 128 chars).`,
    );
  }
  return trimmed;
}

// Returns ~/.cypherclaw/sessions/, creating it if it doesn't exist yet.
export async function resolveSessionsDir(): Promise<string> {
  const dir = path.join(os.homedir(), ".cypherclaw", "sessions");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Returns the absolute path to a session's JSONL file.
export async function resolveSessionPath(name: string): Promise<string> {
  const safe = validateSessionName(name);
  const dir = await resolveSessionsDir();
  return path.join(dir, `${safe}.jsonl`);
}

// ── Rolling window ────────────────────────────────────────────────────────────
// Slices the message array to the last (limit * 2) messages, then nudges the
// start forward until the first kept message is a "user" message. This avoids
// starting a context mid-turn with a dangling assistant message.

function applyHistoryLimit(messages: Message[], limit: number): Message[] {
  const maxMessages = limit * 2;
  if (messages.length <= maxMessages) return messages;

  // Take the tail.
  const sliced = messages.slice(messages.length - maxMessages);

  // Align to the first user message so we never start on an assistant turn.
  const firstUserIdx = sliced.findIndex((m) => m.role === "user");
  return firstUserIdx > 0 ? sliced.slice(firstUserIdx) : sliced;
}

// ── Load ──────────────────────────────────────────────────────────────────────

// Loads a session and applies the rolling window.
// Returns null when the session file doesn't exist yet (new session).
export async function loadSession(
  name: string,
  historyLimit = DEFAULT_HISTORY_LIMIT,
): Promise<Message[] | null> {
  const filePath = await resolveSessionPath(name);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    // File not found → new session, not an error.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const messages: Message[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      // Parse and accept only lines that look like valid Message objects.
      const parsed = JSON.parse(trimmed) as Partial<Message>;
      if (
        typeof parsed.role === "string" &&
        typeof parsed.content === "string" &&
        (parsed.role === "user" || parsed.role === "assistant")
      ) {
        messages.push({ role: parsed.role, content: parsed.content });
      }
    } catch {
      // Skip malformed lines — partial writes from a previous crash are safe.
    }
  }

  return applyHistoryLimit(messages, historyLimit);
}

// ── Append ────────────────────────────────────────────────────────────────────

// Appends new messages to the session file. Creates the file if needed.
// Only "user" and "assistant" roles are persisted — system messages are
// runtime config and should not be stored in the history file.
export async function appendToSession(name: string, messages: Message[]): Promise<void> {
  const toWrite = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  if (toWrite.length === 0) return;

  const filePath = await resolveSessionPath(name);
  const lines =
    toWrite.map((m) => JSON.stringify({ role: m.role, content: m.content })).join("\n") + "\n";

  await fs.appendFile(filePath, lines, "utf-8");
}

// ── List ──────────────────────────────────────────────────────────────────────

// Cumulative token totals for a session, summed across all turns on disk.
// `turns` is the number of entries (one per completed agent turn) in the file.
export type SessionTokenTotals = TokenUsage & { turns: number };

// ── Token persistence ─────────────────────────────────────────────────────────

// Returns the absolute path to the sidecar token-tracking file for a session.
// Stored alongside the messages file: <session>.tokens.jsonl
// Each line is one JSON entry: { input, output, cacheRead, cacheCreation }
async function resolveTokensPath(name: string): Promise<string> {
  const safe = validateSessionName(name);
  const dir = await resolveSessionsDir();
  return path.join(dir, `${safe}.tokens.jsonl`);
}

// Appends one token usage entry for the completed turn to the sidecar file.
export async function appendSessionTokens(name: string, usage: TokenUsage): Promise<void> {
  const filePath = await resolveTokensPath(name);
  const line = JSON.stringify({
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheCreation: usage.cacheCreation,
  }) + "\n";
  await fs.appendFile(filePath, line, "utf-8");
}

// Reads the sidecar token file and returns cumulative totals.
// Returns null if no token data exists yet for this session.
export async function loadSessionTokenTotals(name: string): Promise<SessionTokenTotals | null> {
  const filePath = await resolveTokensPath(name);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let totals: TokenUsage = zeroUsage();
  let turns = 0;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<TokenUsage>;
      if (
        typeof parsed.input === "number" &&
        typeof parsed.output === "number"
      ) {
        totals = addUsage(totals, {
          input: parsed.input,
          output: parsed.output,
          cacheRead: parsed.cacheRead ?? 0,
          cacheCreation: parsed.cacheCreation ?? 0,
        });
        turns++;
      }
    } catch {
      // Skip malformed lines.
    }
  }

  return turns === 0 ? null : { ...totals, turns };
}

export type SessionInfo = {
  name: string;
  // Total message count across the full file (not the windowed view).
  messageCount: number;
  updatedAt: Date;
  // Token totals for this session (null if no token data recorded yet).
  tokens: SessionTokenTotals | null;
};

// Lists all sessions sorted by most-recently-updated first.
export async function listSessions(): Promise<SessionInfo[]> {
  const dir = await resolveSessionsDir();

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: SessionInfo[] = [];

  await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl") && !e.name.endsWith(".tokens.jsonl"))
      .map(async (entry) => {
        const absPath = path.join(dir, entry.name);
        const sessionName = entry.name.slice(0, -6); // strip ".jsonl"
        try {
          const [stat, raw, tokens] = await Promise.all([
            fs.stat(absPath),
            fs.readFile(absPath, "utf-8"),
            loadSessionTokenTotals(sessionName),
          ]);
          // Count non-empty lines — each line is one message.
          const messageCount = raw.split("\n").filter((l) => l.trim()).length;
          results.push({
            name: sessionName,
            messageCount,
            updatedAt: stat.mtime,
            tokens,
          });
        } catch {
          // Skip files we can't read.
        }
      }),
  );

  return results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

// ── Delete ────────────────────────────────────────────────────────────────────

// Deletes a session file and its token sidecar. Returns true if deleted, false
// if the session file didn't exist (missing sidecar is silently ignored).
export async function deleteSession(name: string): Promise<boolean> {
  const filePath = await resolveSessionPath(name);
  try {
    await fs.unlink(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  // Best-effort removal of the token sidecar — don't fail if it's absent.
  const tokensPath = await resolveTokensPath(name);
  try {
    await fs.unlink(tokensPath);
  } catch {
    // Not an error — sidecar simply may not exist yet.
  }
  return true;
}
