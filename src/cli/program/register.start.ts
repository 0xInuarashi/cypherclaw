// cli/program/register.start.ts
// ------------------------------
// Registers the `cypherclaw start` command.
//
// The gateway is a long-running HTTP server (defined in gateway/server.ts) that
// acts as the backbone of the application — it's the process that channels and
// agents will eventually talk to. This command is responsible for launching it.
//
// Two modes:
//   Default (background daemon):
//     Spawns gateway/daemon.ts as a completely separate, detached Node.js
//     process. "Detached" means it keeps running even after this CLI process
//     exits. The daemon writes its PID to a temp file so that `stop` and
//     `status` can find it later.
//
//   --foreground:
//     Runs the gateway directly inside this process instead of spawning a
//     child. Useful for debugging because you see all log output inline.
//     The process blocks until you press Ctrl+C.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { GATEWAY_HOST, GATEWAY_PORT } from "../../gateway/server.js";
import { isProcessRunning, readPid } from "../../gateway/pid.js";

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start the CypherClaw gateway in the background")
    .option("-p, --port <port>", "Port to listen on", String(GATEWAY_PORT))
    .option("--foreground", "Run in the foreground instead of as a background daemon")
    .action(async (opts: { port: string; foreground?: boolean }) => {
      const port = parseInt(opts.port, 10);

      // Guard against starting a second gateway. readPid() reads the PID file
      // that the daemon wrote when it last started, and isProcessRunning()
      // sends signal 0 to that PID — a zero-cost way to test if the OS still
      // has a process with that ID without actually killing it.
      const existingPid = await readPid();
      if (existingPid !== null && isProcessRunning(existingPid)) {
        console.log(`[cypherclaw] Gateway is already running (pid ${existingPid}) on ${GATEWAY_HOST}:${port}`);
        return;
      }

      if (opts.foreground) {
        // Foreground mode: start the server in this process and block forever.
        // Signal handlers allow Ctrl+C / SIGTERM to gracefully close the server
        // (which also deletes the PID file) before exiting.
        const { startGatewayServer } = await import("../../gateway/server.js");
        const { buildAgentFactory } = await import("../../gateway/bootstrap.js");
        const getAgent = await buildAgentFactory();
        const gw = await startGatewayServer({ port, getAgent });

        process.on("SIGINT", async () => {
          console.log("\n[cypherclaw] Shutting down...");
          await gw.close();
          process.exit(0);
        });

        process.on("SIGTERM", async () => {
          await gw.close();
          process.exit(0);
        });

        // Keep the process alive indefinitely (it would otherwise exit after
        // the async action handler returns). The server already owns the event
        // loop, so this promise just makes the intent explicit.
        await new Promise<never>(() => {});
      } else {
        // Background mode: resolve the absolute path to the daemon entry file,
        // then spawn it as a detached child process. We pass the port as a CLI
        // argument so the daemon knows what to bind to.
        //
        // `detached: true`  — the child gets its own process group so it keeps
        //                      running after the parent (this CLI process) exits.
        // `stdio: "ignore"` — we don't attach stdin/stdout/stderr pipes; the
        //                      daemon's output goes nowhere (can be redirected
        //                      to a log file in a future improvement).
        // `child.unref()`   — tells Node's event loop not to wait for the child
        //                      before allowing this process to exit normally.
        const daemonEntry = fileURLToPath(new URL("../../gateway/daemon.js", import.meta.url));

        const child = spawn(process.execPath, [daemonEntry, "--port", String(port)], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, CYPHERCLAW_DAEMON_CHILD: "1" },
        });

        child.unref();
        console.log(`[cypherclaw] Gateway starting on ${GATEWAY_HOST}:${port}...`);
      }
    });
}
