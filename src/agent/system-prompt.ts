// agent/system-prompt.ts
// ----------------------
// Loads the default system prompt template from the markdown preset on disk and
// exposes a small renderer for injecting session-specific values. Using a .md
// file for the content keeps the prompt human-readable and easy to edit
// without touching TypeScript.
//
// The file is read synchronously at module load time so callers can render the
// prompt without async setup.
//
// File resolution uses import.meta.url so the path stays correct regardless
// of where the process is launched from. This works with both tsx (dev) and
// compiled output (as long as the .md file is shipped alongside the .js file).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SYSTEM_PROMPT_TEMPLATE: string = readFileSync(
  join(__dirname, "markdown-presets/system-prompt.md"),
  "utf-8",
).trim();

const SESSION_ID_PLACEHOLDER = "{{SESSION_ID}}";

export function renderSystemPrompt(prompt: string, sessionId: string): string {
  return prompt.replaceAll(SESSION_ID_PLACEHOLDER, sessionId);
}

export function renderDefaultSystemPrompt(sessionId: string): string {
  return renderSystemPrompt(DEFAULT_SYSTEM_PROMPT_TEMPLATE, sessionId);
}
