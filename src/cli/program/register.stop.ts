// cli/program/register.stop.ts
// -----------------------------
// Registers the `cypherclaw stop` command.
//
// Stopping the daemon is a two-phase operation:
//   Phase 1 — Graceful (SIGTERM):
//     We ask the process to shut down cleanly. The daemon's signal handlers
//     (in gateway/daemon.ts) catch SIGTERM, close the HTTP server, delete the
//     PID file, and exit. We then poll every 250 ms to see if it's gone.
//
//   Phase 2 — Forceful (SIGKILL), only if phase 1 times out:
//     After ~5 seconds (20 × 250 ms) we give up waiting and send SIGKILL,
//     which the OS enforces immediately. The process cannot intercept SIGKILL.
//
// Edge cases handled:
//   - No PID file at all → gateway was never started (or already cleaned up).
//   - PID file exists but no process at that PID → stale file from a crash;
//     we delete it and report the situation.

import type { Command } from "commander";
import { clearPid, isProcessRunning, readPid } from "../../gateway/pid.js";

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop the CypherClaw gateway")
    .action(async () => {
      // Read the PID that the daemon recorded when it started.
      const pid = await readPid();

      if (pid === null) {
        console.log("[cypherclaw] Gateway is not running.");
        return;
      }

      if (!isProcessRunning(pid)) {
        // PID file exists but the process is gone — the daemon crashed or was
        // killed externally without cleaning up. Remove the stale file.
        console.log("[cypherclaw] Gateway process not found — cleaning up stale PID file.");
        await clearPid();
        return;
      }

      // Phase 1: politely ask the process to stop.
      process.kill(pid, "SIGTERM");
      console.log(`[cypherclaw] Sent SIGTERM to gateway (pid ${pid}).`);

      // Poll every 250 ms for up to 5 seconds waiting for the process to exit.
      let attempts = 0;
      while (attempts < 20 && isProcessRunning(pid)) {
        await new Promise((r) => setTimeout(r, 250));
        attempts++;
      }

      // Phase 2: if still alive after the grace period, force-kill it.
      if (isProcessRunning(pid)) {
        process.kill(pid, "SIGKILL");
        console.log(`[cypherclaw] Force-killed gateway (pid ${pid}).`);
      } else {
        console.log("[cypherclaw] Gateway stopped.");
      }

      // Whether we killed it gracefully or by force, clean up the PID file.
      // (The daemon normally deletes it itself on SIGTERM, but SIGKILL prevents
      // that, so we do it here as a safety net.)
      await clearPid();
    });
}
