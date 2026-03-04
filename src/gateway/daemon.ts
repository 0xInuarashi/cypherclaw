// gateway/daemon.ts
// ------------------
// This is the entry point for the background daemon process.
//
// When you run `cypherclaw start` (without --foreground), the `start` command
// spawns a brand-new, completely independent Node.js process pointing at this
// file. That child process then runs in the background, owned by the OS, and
// keeps running even after the CLI process exits.
//
// This file's job is small but critical:
//   1. Parse the --port argument that the `start` command passes in.
//   2. Start the gateway HTTP server.
//   3. Stay alive (the server's event loop handles this) and listen for OS
//      signals that tell it to shut down cleanly.
//
// Signal handling:
//   SIGTERM — sent by `cypherclaw stop` (or systemd/launchd if we ever
//             integrate with those). We close the server gracefully.
//   SIGINT  — sent when a user presses Ctrl+C in a terminal that has the
//             daemon attached (e.g. during development). Same response.

import process from "node:process";
import { startGatewayServer } from "./server.js";

// Parse the --port <value> argument from the command line.
// argv[0] = node binary, argv[1] = this script path, argv[2..] = our args.
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : undefined;

// Start the gateway. This binds the port and writes the PID file.
// The `await` here works because this file is loaded as an ES module and
// Node.js allows top-level await in ES modules.
const gw = await startGatewayServer({ port });

// Graceful shutdown on SIGTERM (the polite kill signal used by `cypherclaw stop`).
process.on("SIGTERM", async () => {
  await gw.close(); // closes the HTTP server and deletes the PID file
  process.exit(0);
});

// Graceful shutdown on SIGINT (Ctrl+C in a terminal).
process.on("SIGINT", async () => {
  await gw.close();
  process.exit(0);
});
