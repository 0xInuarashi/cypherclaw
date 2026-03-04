// cli/program/register.status.ts
// --------------------------------
// Registers the `cypherclaw status` command.
//
// Status reporting happens in two layers:
//
//   Layer 1 — OS process check (via PID file):
//     We read the PID that the daemon recorded on startup and ask the OS
//     whether a process with that ID still exists. This works even if the HTTP
//     server is wedged or overloaded.
//
//   Layer 2 — HTTP health check (via gateway):
//     If the process is alive, we attempt an HTTP GET to the gateway's root
//     endpoint. A successful response means the server is fully up and
//     accepting connections, and we can also display the port and PID from the
//     response body. A failed request (e.g. still starting up, port mismatch)
//     falls back to a gentler "running but not reachable" message.

import type { Command } from "commander";
import { GATEWAY_HOST, GATEWAY_PORT } from "../../gateway/server.js";
import { isProcessRunning, readPid } from "../../gateway/pid.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show the status of the CypherClaw gateway")
    .action(async () => {
      // Layer 1: check whether the PID file exists and the process is alive.
      const pid = await readPid();

      if (pid === null) {
        console.log("[cypherclaw] Status: stopped (no PID file)");
        return;
      }

      if (!isProcessRunning(pid)) {
        // The file exists but the process is gone — likely a crash without cleanup.
        console.log(`[cypherclaw] Status: stopped (stale PID ${pid})`);
        return;
      }

      // Layer 2: process is alive, now confirm the HTTP server is responding.
      try {
        const res = await fetch(`http://${GATEWAY_HOST}:${GATEWAY_PORT}/`);
        const body = await res.json() as { status: string; pid: number };
        console.log(`[cypherclaw] Status: running  pid=${body.pid}  port=${GATEWAY_PORT}`);
      } catch {
        // The process exists but the HTTP server isn't answering — it may still
        // be starting up, or the port in the config changed.
        console.log(`[cypherclaw] Status: running (pid ${pid}) — gateway not reachable on port ${GATEWAY_PORT}`);
      }
    });
}
