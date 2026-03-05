// cli/program/register.sessions.ts
// ---------------------------------
// Registers the `cypherclaw sessions` command group.
//
// Sub-commands:
//   cypherclaw sessions list
//     Prints all saved sessions, sorted most-recently-updated first.
//     Columns: name | messages (total on disk) | last updated (relative time).
//
//   cypherclaw sessions delete <name>
//     Prompts for y/n confirmation, then removes the session file.
//     Prints a clear error if the session doesn't exist.

import type { Command } from "commander";

// Formats a Date as a human-readable relative time string, e.g.:
//   "just now", "5 minutes ago", "3 hours ago", "2 days ago"
function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)  return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)  return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)   return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

export function registerSessionsCommand(program: Command): void {
  // The `sessions` command itself is a group — it has no action of its own,
  // only sub-commands. Running `cypherclaw sessions` alone prints help.
  const sessions = program
    .command("sessions")
    .description("Manage saved conversation sessions");

  // ── sessions list ───────────────────────────────────────────────────────────
  sessions
    .command("list")
    .description("List all saved sessions")
    .action(async () => {
      const { listSessions } = await import("../../sessions/index.js");
      const list = await listSessions();

      if (list.length === 0) {
        console.log("No saved sessions. Start one with: cypherclaw chat --session <name>");
        return;
      }

      // Print a simple padded table.
      // Column widths adapt to the longest name (min 20 chars wide).
      const nameWidth  = Math.max(20, ...list.map((s) => s.name.length)) + 2;
      const msgWidth   = 10;

      const header =
        "NAME".padEnd(nameWidth) +
        "MESSAGES".padEnd(msgWidth) +
        "UPDATED";

      const divider = "─".repeat(header.length);

      console.log("\n" + header);
      console.log(divider);

      for (const session of list) {
        const row =
          session.name.padEnd(nameWidth) +
          String(session.messageCount).padEnd(msgWidth) +
          relativeTime(session.updatedAt);
        console.log(row);
      }

      console.log();
    });

  // ── sessions delete <name> ──────────────────────────────────────────────────
  sessions
    .command("delete <name>")
    .description("Delete a saved session")
    .action(async (name: string) => {
      const { deleteSession } = await import("../../sessions/index.js");

      // Ask for confirmation before destroying data.
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });

      await new Promise<void>((resolve) => {
        rl.question(
          `Delete session "${name}"? This cannot be undone. [y/n] `,
          async (answer) => {
            rl.close();
            const confirmed =
              answer.trim().toLowerCase() === "y" ||
              answer.trim().toLowerCase() === "yes";

            if (!confirmed) {
              console.log("Cancelled.");
              resolve();
              return;
            }

            const deleted = await deleteSession(name);
            if (deleted) {
              console.log(`Deleted session "${name}".`);
            } else {
              console.error(`Session "${name}" not found.`);
              process.exitCode = 1;
            }
            resolve();
          },
        );
      });
    });
}
