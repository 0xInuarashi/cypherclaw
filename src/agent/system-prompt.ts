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
//
// Dynamic placeholders resolved at session start via resolveSystemPrompt():
//   {{SESSION_ID}} — the active session identifier
//   {{DATETIME}}   — current date and time in UTC (e.g. "Monday, 8 March 2026, 20:41 UTC")
//   {{HOSTNAME}}   — machine hostname
//   {{OS}}         — platform, architecture, and kernel version
//   {{CPU}}        — CPU core count and model
//   {{MEMORY}}     — total system memory in GB
//   {{NODE}}       — Node.js runtime version

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SYSTEM_PROMPT: string = readFileSync(
  join(__dirname, "markdown-presets/system-prompt.md"),
  "utf-8",
).trim();

export function resolveSystemPrompt(template: string, sessionId: string): string {
  const now = new Date();
  const datetime = now.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() ?? "unknown";
  const cpuCount = cpus.length;
  const memoryGb = (os.totalmem() / 1024 ** 3).toFixed(1);

  return template
    .replace(/\{\{SESSION_ID\}\}/g, sessionId)
    .replace(/\{\{DATETIME\}\}/g,   datetime)
    .replace(/\{\{HOSTNAME\}\}/g,   os.hostname())
    .replace(/\{\{OS\}\}/g,         `${os.platform()} ${os.arch()} (kernel ${os.release()})`)
    .replace(/\{\{CPU\}\}/g,        `${cpuCount}× ${cpuModel}`)
    .replace(/\{\{MEMORY\}\}/g,     `${memoryGb} GB`)
    .replace(/\{\{NODE\}\}/g,       process.version);
}
