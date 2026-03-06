// tools/secret-get.ts
// -------------------
// Retrieves a named secret from the encrypted secrets store
// (.cypherclaw/secrets/store.enc).
//
// The value is returned directly to the agent context. It is never written
// to disk or logged — the stderr line only prints the secret name, not the value.

import type { ToolDefinition } from "./types/types.js";
import { readSecrets } from "./secrets-utils.js";

export const secretGetTool: ToolDefinition = {
  name: "get_secret",
  description:
    "Retrieve a named secret from the encrypted secrets store. " +
    "Use this to fetch credentials, API keys, or tokens stored with set_secret.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the secret to retrieve.",
      },
    },
    required: ["name"],
  },

  async execute(args): Promise<string> {
    const name = (args["name"] as string).trim();

    if (!name) return "Error: secret name must not be empty.";

    process.stderr.write(`\x1b[33m[get_secret]\x1b[0m ${name}\n`);

    try {
      const secrets = await readSecrets();

      if (!(name in secrets)) {
        return `Error: no secret named "${name}" found.`;
      }

      return secrets[name];
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error retrieving secret: ${error.message ?? String(err)}`;
    }
  },
};
