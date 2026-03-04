// gateway/pid.ts
// ---------------
// Utilities for managing a PID (Process ID) file.
//
// A PID file is the standard Unix pattern for tracking a long-running daemon:
//   - When the daemon starts, it writes its own PID (a plain integer) to a
//     known file location on disk.
//   - When the CLI wants to stop or check on the daemon, it reads that file to
//     get the PID, then uses OS signals to communicate with the process.
//   - When the daemon exits cleanly, it deletes the file.
//
// We store the PID file in the OS temp directory (e.g. /tmp on Linux/macOS)
// because it's writable by any user and is automatically cleaned up on reboot.
// The filename is fixed so every CLI invocation knows exactly where to look.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Absolute path to the PID file, e.g. "/tmp/cypherclaw.pid".
const PID_FILE = path.join(os.tmpdir(), "cypherclaw.pid");

// Write the given PID to the PID file, overwriting any previous content.
// Called by the gateway server immediately after it successfully starts.
export async function writePid(pid: number): Promise<void> {
  await fs.writeFile(PID_FILE, String(pid), "utf-8");
}

// Read the PID from the PID file. Returns null if the file doesn't exist or
// its content isn't a valid integer (e.g. it was corrupted or left empty).
export async function readPid(): Promise<number | null> {
  try {
    const content = await fs.readFile(PID_FILE, "utf-8");
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    // File not found (ENOENT) or any other read error — treat as "no daemon".
    return null;
  }
}

// Delete the PID file. Called on clean shutdown so the next `status` check
// doesn't find a stale file and incorrectly report the daemon as running.
// Errors (e.g. file already gone) are silently ignored because the end result
// is the same: no PID file on disk.
export async function clearPid(): Promise<void> {
  try {
    await fs.unlink(PID_FILE);
  } catch {
  }
}

// Check whether a process with the given PID is currently running on this
// machine. We exploit the fact that kill(pid, 0) is a no-op signal — it does
// not actually send anything — but it throws an error if the PID doesn't
// exist or we don't have permission to signal it.
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
