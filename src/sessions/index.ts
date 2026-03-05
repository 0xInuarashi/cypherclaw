// sessions/index.ts
// -----------------
// Barrel export for the sessions module.

export {
  DEFAULT_HISTORY_LIMIT,
  validateSessionName,
  resolveSessionsDir,
  resolveSessionPath,
  loadSession,
  appendToSession,
  listSessions,
  deleteSession,
} from "./store.js";

export type { SessionInfo } from "./store.js";
