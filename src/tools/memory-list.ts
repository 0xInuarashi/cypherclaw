// tools/memory-list.ts
// --------------------
// Lists files in the agent's memory store.
//
// Two scopes are available:
//   "session" — scoped to the current session (.cypherclaw/memory/sessions/<sessionId>/).
//               Automatically isolated; no cross-session pollution.
//   "global"  — shared across all sessions (.cypherclaw/memory/global/).
//               Use for long-term, project-wide knowledge.
//
// This is the entry point for memory-aware behaviour: the agent calls
// list_memory at the start of a session to discover what it has remembered,
// then uses read_memory to pull the relevant files into context.

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";

const MEMORY_BASE = () => path.join(process.cwd(), ".cypherclaw", "memory");

export function resolveMemoryScope(scope: "session" | "global", sessionId?: string): string {
  if (scope === "global") {
    return path.join(MEMORY_BASE(), "global");
  }
  if (!sessionId) {
    throw new Error("sessionId is required for session-scoped memory.");
  }
  return path.join(MEMORY_BASE(), "sessions", sessionId);
}

export function createListMemoryTool(sessionId?: string): ToolDefinition {
  return {
    name: "list_memory",
    description:
      "List files in the agent memory store. " +
      "scope=\"session\" lists memory for the current session only (.cypherclaw/memory/sessions/<id>/). " +
      "scope=\"global\" lists long-term memory shared across all sessions (.cypherclaw/memory/global/). " +
      "Call this at session start for both scopes to load relevant context, " +
      "then use read_memory to load specific files.",

    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["session", "global"],
          description: "Memory scope to list. \"session\" for current-session memory; \"global\" for long-term shared memory.",
        },
      },
      required: ["scope"],
    },

    async execute(args): Promise<string> {
      const scope = (args["scope"] as "session" | "global");

      let memoryDir: string;
      try {
        memoryDir = resolveMemoryScope(scope, sessionId);
      } catch (err: unknown) {
        return `Error: ${(err as Error).message}`;
      }

      process.stderr.write(`\x1b[33m[list_memory:${scope}]\x1b[0m ${memoryDir}\n`);

      try {
        const entries = await fs.readdir(memoryDir, { withFileTypes: true });
        const files = entries
          .filter((e) => e.isFile())
          .map((e) => e.name)
          .sort();

        if (files.length === 0) {
          return `(no ${scope} memory files yet)`;
        }

        return files.join("\n");
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (error.code === "ENOENT") {
          return `(no ${scope} memory files yet)`;
        }
        return `Error listing memory: ${error.message ?? String(err)}`;
      }
    },
  };
}

export const listMemoryTool: ToolDefinition = createListMemoryTool();
