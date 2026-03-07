// gateway/server.ts
// ------------------
// Defines and starts the gateway HTTP server.
//
// The gateway is the central hub of CypherClaw. It exposes a small HTTP API
// over localhost so that external connector processes (Discord, Telegram, …)
// can send messages to the agent and register themselves, without any changes
// to the core codebase.
//
// Endpoints
// ---------
//   GET  /                      Health check — no auth required.
//   POST /chat                  Send a message; get a reply. Auth required.
//   GET  /channels              List registered connectors.  Auth required.
//   POST /channels/register     Connector announces itself.  Auth required.
//
// Auth
// ----
//   All endpoints except GET / require an Authorization: Bearer <token>
//   header. Tokens are created via `cypherclaw token create <name>` and stored
//   under ~/.cypherclaw/tokens/. Connectors read that file to
//   obtain the credential.
//
// Why HTTP?
//   HTTP gives us a simple, universally understood way for CLI commands
//   and connectors to talk to the background daemon without needing a
//   shared socket or custom protocol.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { clearPid, writePid } from "./pid.js";
import { validateBearer } from "./auth.js";
import type { AgentFn } from "../agent/index.js";

export const GATEWAY_PORT = 59_152;
export const GATEWAY_HOST = "127.0.0.1";

// A connector process that has announced itself to the gateway.
export type RegisteredChannel = {
  name: string;
  pid: number;
  registeredAt: string;
};

export type GatewayServer = {
  port: number;
  close: () => Promise<void>;
};

// Options accepted by startGatewayServer.
type ServerOpts = {
  port?: number;
  // Factory called with a sessionId to obtain an AgentFn. The daemon creates
  // one agent per session and caches it in memory between turns so conversation
  // history is preserved. When absent, POST /chat returns 503.
  getAgent?: (sessionId: string) => Promise<AgentFn>;
};

// ── Per-session turn queue ────────────────────────────────────────────────────
//
// Serialises concurrent /chat requests that share the same sessionId so that
// history is never read/written by two turns at the same time.
//
// Because Node.js is single-threaded, the synchronous get→set pair is atomic:
// no other request can interleave between reading `prev` and writing the new
// entry, even though the function is async.

const chatQueues = new Map<string, Promise<void>>();

async function withSessionQueue<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chatQueues.get(sessionId) ?? Promise.resolve();

  let done!: () => void;
  const slot = new Promise<void>((r) => { done = r; });
  const entry = prev.then(() => slot);
  chatQueues.set(sessionId, entry);

  try {
    await prev;
    return await fn();
  } finally {
    done();
    if (chatQueues.get(sessionId) === entry) chatQueues.delete(sessionId);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── Request handlers ─────────────────────────────────────────────────────────

async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ServerOpts,
): Promise<void> {
  if (!opts.getAgent) {
    sendJson(res, 503, { error: "No agent configured" });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>)["message"] !== "string"
  ) {
    sendJson(res, 400, { error: "message (string) is required" });
    return;
  }

  const { message, sessionId } = body as { message: string; sessionId?: string };
  const sid = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : randomUUID();

  const reply = await withSessionQueue(sid, async () => {
    const agent = await opts.getAgent(sid);
    return agent(message);
  });

  sendJson(res, 200, { reply, sessionId: sid });
}

async function handleChannelRegister(
  req: IncomingMessage,
  res: ServerResponse,
  registry: Map<string, RegisteredChannel>,
): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const b = body as Record<string, unknown>;
  if (typeof b["name"] !== "string" || typeof b["pid"] !== "number") {
    sendJson(res, 400, { error: "name (string) and pid (number) are required" });
    return;
  }

  const channel: RegisteredChannel = {
    name: b["name"],
    pid: b["pid"],
    registeredAt: new Date().toISOString(),
  };

  registry.set(channel.name, channel);
  console.log(`[cypherclaw] Channel registered: ${channel.name} (pid ${channel.pid})`);

  sendJson(res, 200, { ok: true });
}

// ── Server factory ────────────────────────────────────────────────────────────

export async function startGatewayServer(opts?: ServerOpts): Promise<GatewayServer> {
  const port = opts?.port ?? GATEWAY_PORT;

  // In-memory registry of connected channel daemons. Connectors re-register
  // each time they start, so this is rebuilt fresh on every daemon boot.
  const channelRegistry = new Map<string, RegisteredChannel>();

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${GATEWAY_HOST}`);

    // ── GET / — health check (no auth) ───────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/") {
      sendJson(res, 200, { status: "ok", pid: process.pid });
      return;
    }

    // ── Auth guard for all other routes ──────────────────────────────────────
    if (!(await validateBearer(req))) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    // ── POST /chat ────────────────────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/chat") {
      await handleChat(req, res, opts ?? {});
      return;
    }

    // ── GET /channels ─────────────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/channels") {
      sendJson(res, 200, { channels: [...channelRegistry.values()] });
      return;
    }

    // ── POST /channels/register ───────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/channels/register") {
      await handleChannelRegister(req, res, channelRegistry);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error("[cypherclaw] Gateway request error:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal server error" });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, GATEWAY_HOST, resolve);
    server.once("error", reject);
  });

  await writePid(process.pid);

  console.log(`[cypherclaw] Gateway started on ${GATEWAY_HOST}:${port} (pid ${process.pid})`);

  return {
    port,
    close: async () => {
      await clearPid();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
