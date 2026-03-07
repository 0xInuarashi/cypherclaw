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
//     `status` can find it later. All daemon output is appended to the gateway
//     log file (see gateway/log.ts).
//
//   --foreground:
//     Runs the gateway directly inside this process instead of spawning a
//     child. Useful for debugging because you see all log output inline.
//     The process blocks until you press Ctrl+C.
//
// Flags:
//   --debug    Enable high-level agentic loop traces (rounds, tool calls,
//              replies). Passed through to the daemon in background mode.
//   --raw      Enable raw JSON request/response logging for every API call.
//              Passed through to the daemon in background mode.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { GATEWAY_HOST, GATEWAY_PORT } from "../../gateway/server.js";
import { isProcessRunning, readPid } from "../../gateway/pid.js";
import { GATEWAY_LOG_FILE, openLogFileFd } from "../../gateway/log.js";

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start the CypherClaw gateway in the background")
    .option("-p, --port <port>", "Port to listen on", String(GATEWAY_PORT))
    .option("--foreground", "Run in the foreground instead of as a background daemon")
    .option("--debug", "Log high-level agentic loop traces (rounds, tool calls, replies)")
    .option("--raw", "Log raw JSON request/response bodies exchanged with the API")
    .action(async (opts: { port: string; foreground?: boolean; debug?: boolean; raw?: boolean }) => {
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
        // Loggers are created here (if flags are set) and passed to bootstrap.
        // Signal handlers allow Ctrl+C / SIGTERM to gracefully close the server
        // (which also deletes the PID file) before exiting.
        const { startGatewayServer } = await import("../../gateway/server.js");
        const { buildAgentFactory } = await import("../../gateway/bootstrap.js");

        let onEvent;
        if (opts.debug || opts.raw) {
          const { createDebugLogger, createRawLogger, combineLoggers } = await import("../../debug/logger.js");
          const loggers = [
            ...(opts.debug ? [createDebugLogger()] : []),
            ...(opts.raw   ? [createRawLogger()]   : []),
          ];
          onEvent = combineLoggers(...loggers);
        }

        const getAgent = await buildAgentFactory({ onEvent });
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
        // then spawn it as a detached child process. We pass the port and any
        // logging flags as CLI arguments so the daemon applies them.
        //
        // `detached: true`  — the child gets its own process group so it keeps
        //                      running after the parent (this CLI process) exits.
        // `stdio`           — stdout and stderr are both redirected to the gateway
        //                      log file so all daemon output is preserved on disk.
        // `child.unref()`   — tells Node's event loop not to wait for the child
        //                      before allowing this process to exit normally.
        const isTsx = import.meta.url.endsWith(".ts");
        const daemonEntry = fileURLToPath(
          new URL(
            isTsx ? "../../gateway/daemon.ts" : "../../gateway/daemon.js",
            import.meta.url,
          ),
        );

        const extraFlags = [
          "--port", String(port),
          ...(opts.debug ? ["--debug"] : []),
          ...(opts.raw   ? ["--raw"]   : []),
        ];

        const spawnArgs = isTsx
          ? [
              path.resolve(fileURLToPath(new URL("../../../", import.meta.url)), "node_modules/.bin/tsx"),
              daemonEntry,
              ...extraFlags,
            ]
          : [daemonEntry, ...extraFlags];

        const logFd = openLogFileFd();

        const child = spawn(process.execPath, spawnArgs, {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: { ...process.env, CYPHERCLAW_DAEMON_CHILD: "1" },
        });

        child.unref();
        console.log(`[cypherclaw] Gateway starting on ${GATEWAY_HOST}:${port}...`);
        console.log(`[cypherclaw] Logs: ${GATEWAY_LOG_FILE}`);
      }
    });
}
