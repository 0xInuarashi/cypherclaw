// gateway/server.ts
// ------------------
// Defines and starts the gateway HTTP server.
//
// The gateway is the central "control plane" of CypherClaw. Right now it's a
// minimal HTTP server with a single health-check endpoint, but it will grow to
// handle routing between channels (Terminal, Telegram, WhatsApp, …) and the
// agent logic.
//
// Why HTTP?
//   HTTP gives us a simple, universally understood way for the CLI commands
//   (`status`, future `send`, etc.) to talk to the background daemon without
//   needing a shared socket or custom protocol. The `status` command, for
//   example, just does a GET / to confirm the server is alive.
//
// Constants (GATEWAY_PORT, GATEWAY_HOST) are exported so that other modules —
// `start`, `status` — all agree on the same address without hard-coding it.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import { clearPid, writePid } from "./pid.js";

// The port the gateway listens on. 59152 is in the ephemeral/private range and
// unlikely to conflict with other well-known services.
export const GATEWAY_PORT = 59_152;

// Bind only to localhost. The gateway is meant to be a local-only service;
// binding to 0.0.0.0 would expose it on all network interfaces.
export const GATEWAY_HOST = "127.0.0.1";

// The object returned by startGatewayServer — holds the bound port and a
// method to shut the server down cleanly.
export type GatewayServer = {
  port: number;
  close: () => Promise<void>;
};

// Request handler for all incoming HTTP requests.
// For now there's just one endpoint: GET / → { status: "ok", pid: <number> }.
// The `pid` field is useful for `cypherclaw status` to cross-check against the
// PID file and confirm it's talking to the right process.
function handleRequest(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", pid: process.pid }));
}

// Start the HTTP server and bind it to the given port (defaulting to
// GATEWAY_PORT). Returns a GatewayServer handle once the server is listening.
//
// Immediately after binding, we write the current process PID to the PID file
// so that `stop` and `status` commands can locate this daemon later.
export async function startGatewayServer(opts?: { port?: number }): Promise<GatewayServer> {
  const port = opts?.port ?? GATEWAY_PORT;
  const server = createServer(handleRequest);

  // server.listen is callback-based; we wrap it in a Promise so callers can
  // await it. The 'error' listener covers bind failures (e.g. port in use).
  await new Promise<void>((resolve, reject) => {
    server.listen(port, GATEWAY_HOST, resolve);
    server.once("error", reject);
  });

  // Record this process's PID so the CLI can find and signal this daemon later.
  await writePid(process.pid);

  console.log(`[cypherclaw] Gateway started on ${GATEWAY_HOST}:${port} (pid ${process.pid})`);

  return {
    port,
    close: async () => {
      // Remove the PID file first so that any concurrent `status` call
      // immediately sees the daemon as stopped, even before the server socket
      // is fully closed.
      await clearPid();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
