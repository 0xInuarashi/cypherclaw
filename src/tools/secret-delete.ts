// tools/secret-delete.ts
// ----------------------
// Removes a named secret from the encrypted secrets store.
//
// The store is re-encrypted and written back without the deleted entry.
// Returns an error if the named secret does not exist.

import type { ToolDefinition } from "./types/types.js";
import { readSecrets, writeSecrets } from "./secrets-utils.js";

export const secretDeleteTool: ToolDefinition = {
  name: "delete_secret",
  description:
    "Remove a named secret from the encrypted secrets store. This is permanent.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the secret to delete.",
      },
    },
    required: ["name"],
  },

  async execute(args): Promise<string> {
    const name = (args["name"] as string).trim();

    if (!name) return "Error: secret name must not be empty.";

    process.stderr.write(`\x1b[33m[delete_secret]\x1b[0m ${name}\n`);

    try {
      const secrets = await readSecrets();

      if (!(name in secrets)) {
        return `Error: no secret named "${name}" found.`;
      }

      delete secrets[name];
      await writeSecrets(secrets);
      return `Secret "${name}" deleted.`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error deleting secret: ${error.message ?? String(err)}`;
    }
  },
};
