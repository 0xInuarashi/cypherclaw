// gateway/log.ts
// ---------------
// Centralised location for the gateway log file path and helpers.
//
// The gateway daemon runs detached from any terminal, so all of its output
// is redirected to a well-known log file on disk. Both the parent CLI (which
// opens the file descriptor before spawning) and the daemon itself (which may
// write a startup banner directly) share this constant so the path is never
// duplicated.
//
// Log file location: ~/.cypherclaw/gateway/gateway.log
//
// This mirrors the convention used by ~/.cypherclaw/tokens/ — both are
// user-level, machine-global concerns that belong to the daemon rather than
// to any specific project directory.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const GATEWAY_LOG_DIR  = path.join(os.homedir(), ".cypherclaw", "gateway");
export const GATEWAY_LOG_FILE = path.join(GATEWAY_LOG_DIR, "gateway.log");

// Open the log file for appending and return a numeric file descriptor
// suitable for passing directly to Node's spawn `stdio` option.
// Creates the directory if it doesn't exist yet.
// Append mode ensures successive daemon runs accumulate in one file rather
// than overwriting previous sessions.
export function openLogFileFd(): number {
  fs.mkdirSync(GATEWAY_LOG_DIR, { recursive: true });
  return fs.openSync(GATEWAY_LOG_FILE, "a");
}
