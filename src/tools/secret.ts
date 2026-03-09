// tools/secret.ts
// ---------------
// Tools for managing named secrets in the encrypted secrets store
// (~/.cypherclaw/secrets/store.enc, AES-256-GCM).
//
// The encryption key lives at ~/.cypherclaw/secrets.key and is generated
// automatically on first use. Values are never written to disk unencrypted
// or logged — only secret names appear in stderr traces.

import type { ToolDefinition } from "./types/types.js";
import { readSecrets, writeSecrets } from "./utils/secrets.js";

// --- list_secrets ---

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

// --- get_secret ---

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

// --- set_secret ---

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

// --- overwrite_secret ---

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

// --- delete_secret ---

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
