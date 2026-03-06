// tools/secret-set.ts
// -------------------
// Stores a named secret in the encrypted secrets store
// (.cypherclaw/secrets/store.enc).
//
// The encryption key is loaded from .cypherclaw/secrets.key and generated
// automatically on first use. Rejects writes if a secret with the same name
// already exists — use overwrite_secret to replace an existing secret.

import type { ToolDefinition } from "./types/types.js";
import { readSecrets, writeSecrets } from "./secrets-utils.js";

export const secretSetTool: ToolDefinition = {
  name: "set_secret",
  description:
    "Store a named secret (API key, password, token, etc.) in the encrypted secrets store. " +
    "Use this whenever you need to persist a credential for future sessions. " +
    "Fails if a secret with the same name already exists — use overwrite_secret to replace it.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "A short, descriptive name for the secret (e.g. \"github_token\").",
      },
      value: {
        type: "string",
        description: "The secret value to store.",
      },
    },
    required: ["name", "value"],
  },

  async execute(args): Promise<string> {
    const name = (args["name"] as string).trim();
    const value = args["value"] as string;

    if (!name) return "Error: secret name must not be empty.";

    process.stderr.write(`\x1b[33m[set_secret]\x1b[0m ${name}\n`);

    try {
      const secrets = await readSecrets();
      if (Object.prototype.hasOwnProperty.call(secrets, name)) {
        return `Error: a secret named "${name}" already exists. Use overwrite_secret to replace it.`;
      }
      secrets[name] = value;
      await writeSecrets(secrets);
      return `Secret "${name}" stored successfully.`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error storing secret: ${error.message ?? String(err)}`;
    }
  },
};
