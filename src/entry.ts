#!/usr/bin/env node
// This is the very first file Node.js executes when you run the `cypherclaw`
// binary. The shebang line above (#!/usr/bin/env node) tells the OS to hand
// this file to Node instead of trying to run it as a shell script.
//
// Its only responsibility is to hand off to the real CLI logic as quickly as
// possible. We use a dynamic import (import()) rather than a top-level import
// statement so that any error that occurs while *loading* the CLI module is
// caught cleanly here and printed in a readable way, rather than crashing with
// an unformatted Node.js stack trace.
//
// Flow:
//   entry.ts  →  cli/run.ts (runCli)  →  cli/program.ts (buildProgram)
//             →  individual command handlers

import process from "node:process";

import("./cli/run.js")
  .then(({ runCli }) => runCli(process.argv))
  .catch((error) => {
    // If the CLI module itself fails to load (e.g. a syntax error, missing
    // dependency, or broken import), surface the full stack trace and exit
    // with a non-zero code so shell scripts and CI can detect the failure.
    console.error(
      "[cypherclaw] Failed to start CLI:",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
