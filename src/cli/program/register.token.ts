// cli/program/register.token.ts
// ------------------------------
// Registers the `cypherclaw token` command group.
//
// Tokens are named credentials that grant external connectors (Discord,
// Telegram, …) access to the gateway API. Each token is stored as a JSON file
// in ~/.cypherclaw/tokens/<name>.json with mode 0600.
//
// Sub-commands
// ------------
//   token create <name>   Generate a new named token and print it once.
//   token list            List all token names and their creation dates.
//   token revoke <name>   Delete a token, immediately revoking access.
//
// The token value is only ever shown at creation time. After that, it exists
// only on disk — this encourages users to copy it immediately into their
// connector's config.

import type { Command } from "commander";
import { createToken, listTokens, revokeToken } from "../../gateway/auth.js";

export function registerTokenCommand(program: Command): void {
  const token = program
    .command("token")
    .description("Manage API tokens for external connectors");

  // ── token create <name> ───────────────────────────────────────────────────
  token
    .command("create <name>")
    .description("Create a new named API token")
    .action(async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || /[^a-z0-9_-]/i.test(trimmed)) {
        console.error("[cypherclaw] Token name must contain only letters, numbers, hyphens, and underscores.");
        process.exit(1);
      }

      try {
        const value = await createToken(trimmed);
        console.log(`\nToken "${trimmed}" created.\n`);
        console.log(`  ${value}\n`);
        console.log("Copy this value now — it will not be shown again.");
        console.log(`To revoke: cypherclaw token revoke ${trimmed}\n`);
      } catch (err) {
        console.error(`[cypherclaw] ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // ── token list ────────────────────────────────────────────────────────────
  token
    .command("list")
    .description("List all API tokens")
    .action(async () => {
      const entries = await listTokens();

      if (entries.length === 0) {
        console.log("[cypherclaw] No tokens found. Create one with: cypherclaw token create <name>");
        return;
      }

      console.log(`\n${"NAME".padEnd(24)}  CREATED`);
      console.log(`${"─".repeat(24)}  ${"─".repeat(24)}`);
      for (const entry of entries) {
        const date = new Date(entry.createdAt).toLocaleString();
        console.log(`${entry.name.padEnd(24)}  ${date}`);
      }
      console.log();
    });

  // ── token revoke <name> ───────────────────────────────────────────────────
  token
    .command("revoke <name>")
    .description("Revoke (delete) a named API token")
    .action(async (name: string) => {
      try {
        const removed = await revokeToken(name.trim());
        if (removed) {
          console.log(`[cypherclaw] Token "${name}" revoked.`);
        } else {
          console.error(`[cypherclaw] Token "${name}" not found.`);
          process.exit(1);
        }
      } catch (err) {
        console.error(`[cypherclaw] ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}
