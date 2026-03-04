// cli/run.ts
// ----------
// The runCli() function is the true starting point of the application logic.
// entry.ts calls this as soon as it loads, passing the raw process.argv array.
//
// Responsibilities:
//   1. Load environment variables from a .env file so that API keys and config
//      are available before any command action handler runs.
//   2. Build the Commander program (the object that knows all commands and flags).
//   3. Install global process-level error handlers so that any unhandled async
//      error anywhere in the app is caught, logged, and results in a clean exit
//      rather than a cryptic Node.js crash dump.
//   4. Hand argv to Commander so it can parse the command the user typed and
//      call the appropriate action handler.
//
// Why load dotenv here rather than in each command?
//   Centralising it here guarantees env vars are present before any module
//   (even lazily imported ones) tries to read process.env. Doing it per-command
//   would risk a race condition where an import side-effect reads env vars
//   before dotenv has populated them.

import process from "node:process";
import { config as loadDotenv } from "dotenv";

export async function runCli(argv: string[] = process.argv): Promise<void> {
  // Load .env from the current working directory. `override: false` means we
  // never clobber variables that are already set in the shell environment —
  // the real environment always takes precedence over the .env file.
  // If no .env file exists the call is a no-op (dotenv does not throw).
  loadDotenv({ override: false });

  const { buildProgram } = await import("./program.js");
  const program = buildProgram();

  // Catch any unhandled exception thrown synchronously from anywhere in the
  // process (e.g. inside a callback that isn't wrapped in try/catch). Without
  // this handler Node would print a raw stack trace and may or may not exit.
  process.on("uncaughtException", (error) => {
    console.error("[cypherclaw] Uncaught exception:", error instanceof Error ? error.stack : error);
    process.exit(1);
  });

  // Same idea but for async errors — a Promise that was rejected and nobody
  // ever attached a .catch() handler to. These are silent by default in older
  // Node versions, which makes bugs very hard to find.
  process.on("unhandledRejection", (reason) => {
    console.error("[cypherclaw] Unhandled rejection:", reason);
    process.exit(1);
  });

  // Let Commander parse the argv array. parseAsync is used instead of parse
  // because our command action handlers are async functions (they await things
  // like file I/O, HTTP requests, etc.).
  await program.parseAsync(argv);
}
