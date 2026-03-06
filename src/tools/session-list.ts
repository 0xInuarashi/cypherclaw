// tools/session-list.ts
// ---------------------
// Lists all saved sessions in .cypherclaw/sessions/.
//
// The agent calls this to discover what past sessions exist, then uses
// read_session to load the conversation history of a specific session
// for cross-session context.

import type { ToolDefinition } from "./types/types.js";
import { listSessions } from "../sessions/store.js";

const PAGE_SIZE = 100;

export const sessionListTool: ToolDefinition = {
  name: "list_sessions",
  description:
    "List saved sessions in .cypherclaw/sessions/, sorted by most recently updated. " +
    "Returns session names, message counts, and last-updated timestamps. " +
    `Results are paginated (${PAGE_SIZE} per page) — use the page parameter to fetch further pages. ` +
    "Use read_session to load the full conversation history of a specific session.",

  parameters: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description: `Page number to retrieve (1-based, ${PAGE_SIZE} sessions per page). Defaults to 1.`,
      },
    },
    required: [],
  },

  async execute(args): Promise<string> {
    const page = Math.max(1, Math.floor((args["page"] as number | undefined ?? 1)));
    const offset = (page - 1) * PAGE_SIZE;

    process.stderr.write(`\x1b[33m[list_sessions]\x1b[0m page=${page}\n`);

    const all = await listSessions();

    if (all.length === 0) {
      return "(no sessions found)";
    }

    const totalPages = Math.ceil(all.length / PAGE_SIZE);
    const slice = all.slice(offset, offset + PAGE_SIZE);

    if (slice.length === 0) {
      return `Page ${page} is out of range. Total pages: ${totalPages}.`;
    }

    const lines = slice.map((s) => {
      const updated = s.updatedAt.toISOString();
      return `${s.name}  (${s.messageCount} messages, updated ${updated})`;
    });

    const footer = totalPages > 1
      ? `\n\nPage ${page} of ${totalPages} (${all.length} total sessions).`
      : "";

    return lines.join("\n") + footer;
  },
};
