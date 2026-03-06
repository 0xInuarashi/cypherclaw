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
import { startGatewayServer } from "./server.js";
import { buildAgentFactory } from "./bootstrap.js";

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : undefined;

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
