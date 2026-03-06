// gateway/auth.ts
// ----------------
// Named token management for the gateway API.
//
// Each token is a named credential stored as a JSON file under
// ~/.cypherclaw/tokens/<name>.json (mode 0600). Connectors are given a token
// by the user via `cypherclaw token create <name>` and use it as a standard
// HTTP Bearer credential on every request to the gateway.
//
// Multiple tokens can coexist, one per integration. Revoking a token is as
// simple as deleting its file — no daemon restart required because tokens are
// validated against the directory on every request.
//
// Why files instead of a database?
//   Zero dependencies, human-inspectable, trivially backed up, and adequate
//   for the number of tokens a personal assistant will ever have.

import { timingSafeEqual, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";

export const TOKENS_DIR = join(homedir(), ".cypherclaw", "tokens");

// The shape of a token entry persisted to disk.
export type TokenEntry = {
  name: string;
  token: string;
  createdAt: string;
};

// ── Persistence ───────────────────────────────────────────────────────────────

// Create a new named token, persist it, and return the raw token string.
// The caller is responsible for displaying it to the user — it is the only
// time the value is shown in plaintext.
export async function createToken(name: string): Promise<string> {
  await mkdir(TOKENS_DIR, { recursive: true });

  const tokenPath = join(TOKENS_DIR, `${name}.json`);

  // Refuse to silently overwrite an existing token.
  try {
    await readFile(tokenPath);
    throw new Error(`Token "${name}" already exists. Revoke it first with: cypherclaw token revoke ${name}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const token = randomBytes(32).toString("hex");
  const entry: TokenEntry = { name, token, createdAt: new Date().toISOString() };

  await writeFile(tokenPath, JSON.stringify(entry, null, 2), { encoding: "utf8", mode: 0o600 });

  return token;
}

// Delete a named token. Returns true if the token existed, false if not found.
export async function revokeToken(name: string): Promise<boolean> {
  try {
    await unlink(join(TOKENS_DIR, `${name}.json`));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

// List all token entries on disk, sorted by creation date (oldest first).
// The raw token value is included so callers can decide whether to display it.
export async function listTokens(): Promise<TokenEntry[]> {
  let files: string[];
  try {
    files = await readdir(TOKENS_DIR);
  } catch {
    return [];
  }

  const entries: TokenEntry[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(TOKENS_DIR, file), "utf8");
      entries.push(JSON.parse(raw) as TokenEntry);
    } catch {
      // Skip malformed or unreadable files.
    }
  }

  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ── Validation ────────────────────────────────────────────────────────────────

// Find the TokenEntry whose token matches the given bearer string.
// Uses constant-time comparison on each candidate to prevent timing attacks.
// Returns null if no match is found.
export async function findToken(bearer: string): Promise<TokenEntry | null> {
  if (!bearer) return null;

  const entries = await listTokens();

  for (const entry of entries) {
    if (entry.token.length !== bearer.length) continue;
    if (timingSafeEqual(Buffer.from(entry.token), Buffer.from(bearer))) {
      return entry;
    }
  }

  return null;
}

// Extract the Bearer credential from an HTTP request's Authorization header
// and check it against the token store. Returns true on a valid match.
export async function validateBearer(req: IncomingMessage): Promise<boolean> {
  const auth = req.headers["authorization"];
  if (!auth?.startsWith("Bearer ")) return false;

  const bearer = auth.slice(7).trim();
  return (await findToken(bearer)) !== null;
}
