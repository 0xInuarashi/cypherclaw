// tools/secret-list.ts
// --------------------
// Lists the names of all stored secrets — never their values.
//
// Use this to discover what credentials are available before calling get_secret.

import type { ToolDefinition } from "./types/types.js";
import { readSecrets } from "./secrets-utils.js";

export const secretListTool: ToolDefinition = {
  name: "list_secrets",
  description:
    "List the names of all stored secrets. Values are never revealed — use get_secret to retrieve a specific value.",

  parameters: {
    type: "object",
    properties: {},
    required: [],
  },

  async execute(): Promise<string> {
    process.stderr.write(`\x1b[33m[list_secrets]\x1b[0m\n`);

    try {
      const secrets = await readSecrets();
      const names = Object.keys(secrets).sort();

      if (names.length === 0) return "(no secrets stored yet)";

      return names.join("\n");
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error listing secrets: ${error.message ?? String(err)}`;
    }
  },
};
