// tools/secret-overwrite.ts
// -------------------------
// Overwrites an existing named secret in the encrypted secrets store
// (.cypherclaw/secrets/store.enc).
//
// Unlike set_secret, this tool requires the secret to already exist.
// Use set_secret to create a new secret for the first time.

import type { ToolDefinition } from "./types/types.js";
import { readSecrets, writeSecrets } from "./secrets-utils.js";

export const secretOverwriteTool: ToolDefinition = {
  name: "overwrite_secret",
  description:
    "Replace the value of an existing named secret in the encrypted secrets store. " +
    "Fails if no secret with the given name exists — use set_secret to create a new one.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the secret to overwrite.",
      },
      value: {
        type: "string",
        description: "The new secret value.",
      },
    },
    required: ["name", "value"],
  },

  async execute(args): Promise<string> {
    const name = (args["name"] as string).trim();
    const value = args["value"] as string;

    if (!name) return "Error: secret name must not be empty.";

    process.stderr.write(`\x1b[33m[overwrite_secret]\x1b[0m ${name}\n`);

    try {
      const secrets = await readSecrets();
      if (!Object.prototype.hasOwnProperty.call(secrets, name)) {
        return `Error: no secret named "${name}" exists. Use set_secret to create it.`;
      }
      secrets[name] = value;
      await writeSecrets(secrets);
      return `Secret "${name}" overwritten successfully.`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error overwriting secret: ${error.message ?? String(err)}`;
    }
  },
};
