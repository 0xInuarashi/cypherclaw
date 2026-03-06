// tools/session-read.ts
// ---------------------
// Reads the conversation history of a named session from .cypherclaw/sessions/.
//
// The agent uses this to gain context from past sessions — useful for resuming
// work, understanding prior decisions, or referencing earlier findings without
// requiring the user to re-explain them.
//
// Output is formatted as a readable conversation transcript and capped at
// MAX_OUTPUT_CHARS to stay within context limits.

import type { ToolDefinition } from "./types/types.js";
import { loadSession } from "../sessions/store.js";

const MAX_OUTPUT_CHARS = 40_000;
const MAX_HISTORY_TURNS = 200;

export const sessionReadTool: ToolDefinition = {
  name: "read_session",
  description:
    "Read the conversation history of a saved session by name. " +
    "Use list_sessions first to discover available session names. " +
    "Returns a formatted transcript of the session's messages for cross-session context.",

  parameters: {
    type: "object",
    properties: {
      session: {
        type: "string",
        description: "Session name to read (as returned by list_sessions).",
      },
    },
    required: ["session"],
  },

  async execute(args): Promise<string> {
    const session = args["session"] as string;

    process.stderr.write(`\x1b[33m[read_session]\x1b[0m ${session}\n`);

    const messages = await loadSession(session, MAX_HISTORY_TURNS);

    if (messages === null) {
      return `Error: session not found: ${session}`;
    }

    if (messages.length === 0) {
      return "(session exists but has no messages)";
    }

    const lines: string[] = [];
    for (const msg of messages) {
      const label = msg.role === "user" ? "USER" : "ASSISTANT";
      lines.push(`[${label}]\n${msg.content}`);
    }

    const transcript = lines.join("\n\n---\n\n");

    if (transcript.length > MAX_OUTPUT_CHARS) {
      return (
        transcript.slice(0, MAX_OUTPUT_CHARS) +
        `\n\n[transcript truncated — ${transcript.length - MAX_OUTPUT_CHARS} chars omitted]`
      );
    }

    return transcript;
  },
};
