// agent/system-prompt.ts
// ----------------------
// Loads the default system prompt from the markdown preset on disk and exposes
// it as a plain string. Using a .md file for the content keeps the prompt
// human-readable and easy to edit without touching TypeScript.
//
// The file is read synchronously at module load time so callers can import
// DEFAULT_SYSTEM_PROMPT as a plain constant — no async required.
//
// File resolution uses import.meta.url so the path stays correct regardless
// of where the process is launched from. This works with both tsx (dev) and
// compiled output (as long as the .md file is shipped alongside the .js file).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SYSTEM_PROMPT: string = readFileSync(
  join(__dirname, "markdown-presets/system-prompt.md"),
  "utf-8",
).trim();
