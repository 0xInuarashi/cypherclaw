// gateway/daemon.ts
// ------------------
// Entry point for the background gateway daemon process.
//
// When `cypherclaw start` (without --foreground) is run, a detached Node.js
// child process is spawned pointing at this file. Its responsibilities are:
//
//   1. Boot the LLM provider from env config (if available).
//   2. Start the gateway HTTP server.
//   3. Maintain a per-session agent registry so conversation history persists
//      across multiple turns from the same connector session.
//   4. Handle OS signals to shut everything down cleanly.
//
// Auth
// ----
// The daemon itself does not manage tokens. Tokens are created and revoked
// independently via `cypherclaw token create/revoke`. The gateway server reads
// ~/.cypherclaw/tokens/ on every authenticated request, so tokens take effect
// immediately without a daemon restart.
//
// Agent sessions
// --------------
// Connectors identify their conversations with a sessionId (e.g. a Discord
// channel ID). The daemon keeps a Map<sessionId, AgentFn> in memory. On the
// first message for a given sessionId, getAgent() creates an agent and loads
// any existing history from disk. Subsequent messages reuse the same agent
// instance, preserving in-memory history between turns.
//
// Graceful degradation
// --------------------
// If LLM config is missing (env vars not set), the daemon still starts and
// the auth/channel endpoints work normally. POST /chat will return 503 until
// the daemon is restarted with valid config.

import process from "node:process";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { startGatewayServer } from "./server.js";
import { buildAgentFactory } from "./bootstrap.js";

loadDotenv({ override: false });

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : undefined;

// ── Self-daemonization ────────────────────────────────────────────────────────
//
// When invoked directly (e.g. `npm run gateway:daemon`) rather than being
// spawned by `cypherclaw start`, re-launch ourselves as a detached background
// process and exit. The child sets CYPHERCLAW_DAEMON_CHILD=1 so it skips
// this block and proceeds straight to starting the server.

if (!process.env["CYPHERCLAW_DAEMON_CHILD"]) {
  const isTsx = import.meta.url.endsWith(".ts");
  const self = fileURLToPath(import.meta.url);
  const spawnArgs = isTsx
    ? [path.resolve(self, "../../..", "node_modules/.bin/tsx"), self]
    : [self];
  const child = spawn(process.execPath, spawnArgs, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CYPHERCLAW_DAEMON_CHILD: "1" },
  });
  child.unref();
  console.log(`[cypherclaw] Gateway daemon spawned (pid ${child.pid})`);
  process.exit(0);
}

// ── Gateway startup ───────────────────────────────────────────────────────────

const getAgent = await buildAgentFactory();
const gw = await startGatewayServer({ port, getAgent });

// ── Signal handlers ───────────────────────────────────────────────────────────

process.on("SIGTERM", async () => {
  await gw.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await gw.close();
  process.exit(0);
});
