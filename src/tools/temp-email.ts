// src/tools/temp-email.ts
// -----------------------
// Creates disposable email inboxes and reads incoming mail — no signup required.
//
// Primary use case: the agent creates a throwaway address, uses it to sign up
// for a service, polls for the verification email, extracts the link or code,
// and proceeds autonomously.
//
// Two-provider pipeline (automatic fallback):
//   Primary  → Mail.tm  (api.mail.tm)  — free, no key, clean REST + SSE
//   Fallback → Mail.gw  (api.mail.gw)  — identical API, different base URL
//
// Three actions exposed to the model:
//
//   create  — spins up a fresh inbox; returns { address, token }
//              The token is an opaque string (provider::jwt) that must be
//              passed back to list and read. Store it with write_file.
//
//   list    — polls for incoming messages; returns a summary list with IDs,
//              senders, subjects, and snippets. Call repeatedly until the
//              expected email arrives (allow 30–120 s for delivery).
//
//   read    — fetches the full text of one message by ID; runs the body
//              through our readability pipeline so the model receives clean
//              prose rather than raw HTML.

import type { ToolDefinition } from "./types/types.js";
import { cleanText } from "./utils/browser-utils.js";
import { extractReadableContent } from "./utils/readability.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAILTM_BASE = "https://api.mail.tm";
const MAILGW_BASE = "https://api.mail.gw";

const TIMEOUT_MS = 15_000;

// Characters used when generating a random local-part for the address.
const CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";

// ── Helpers ───────────────────────────────────────────────────────────────────

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

// Generates a random lowercase alphanumeric string of `length` characters.
function randomString(length: number): string {
  return Array.from(
    { length },
    () => CHARSET[Math.floor(Math.random() * CHARSET.length)],
  ).join("");
}

// Token format: "mailtm::<jwt>" or "mailgw::<jwt>"
// Encoding the provider prefix lets list/read route to the correct base URL
// without the model needing to track it separately.
function encodeToken(provider: "mailtm" | "mailgw", jwt: string): string {
  return `${provider}::${jwt}`;
}

function decodeToken(token: string): { base: string; jwt: string } {
  const sep = token.indexOf("::");
  if (sep === -1) throw new Error("Invalid token format — was this created by temp_email?");

  const provider = token.slice(0, sep);
  const jwt = token.slice(sep + 2);

  if (provider === "mailtm") return { base: MAILTM_BASE, jwt };
  if (provider === "mailgw") return { base: MAILGW_BASE, jwt };

  throw new Error(`Unknown provider in token: ${provider}`);
}

// ── Mail.tm / Mail.gw shared client ──────────────────────────────────────────
//
// Both providers share the exact same REST API — only the base URL differs.
// All functions below accept `base` so they work for either provider.

// Step 1: fetch available domains and pick the first active one.
//
// Mail.tm and Mail.gw have diverged in their response format:
//   Mail.tm → plain JSON array:        [{ domain, isActive, ... }]
//   Mail.gw → hydra collection:        { "hydra:member": [{ domain, isActive, ... }] }
// We handle both by normalising before filtering.
async function fetchDomain(base: string): Promise<string> {
  const res = await fetch(`${base}/domains`, {
    headers: { Accept: "application/json" },
    signal: withTimeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`GET /domains HTTP ${res.status}`);

  const raw = await res.json();

  type DomainEntry = { domain: string; isActive?: boolean };

  // Normalise: accept either a plain array or a hydra-wrapped collection.
  const list: DomainEntry[] = Array.isArray(raw)
    ? (raw as DomainEntry[])
    : ((raw as { "hydra:member"?: DomainEntry[] })["hydra:member"] ?? []);

  const domains = list.filter((d) => d.isActive !== false);
  if (domains.length === 0) throw new Error("No active domains returned");

  return domains[0].domain;
}

// Step 2: register a new account with a random address + password.
async function createAccount(
  base: string,
  address: string,
  password: string,
): Promise<void> {
  const res = await fetch(`${base}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ address, password }),
    signal: withTimeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST /accounts HTTP ${res.status}: ${body}`);
  }
}

// Step 3: obtain a JWT for the newly created account.
async function getToken(
  base: string,
  address: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ address, password }),
    signal: withTimeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`POST /token HTTP ${res.status}`);

  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("No token in response");

  return data.token;
}

// Fetches the message list for the authenticated inbox.
async function fetchMessages(
  base: string,
  jwt: string,
): Promise<Array<{
  id: string;
  from: { address: string; name?: string };
  subject: string;
  intro: string;
  createdAt: string;
  seen: boolean;
}>> {
  const res = await fetch(`${base}/messages`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    },
    signal: withTimeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`GET /messages HTTP ${res.status}`);

  const data = (await res.json()) as {
    "hydra:member"?: Array<{
      id: string;
      from: { address: string; name?: string };
      subject: string;
      intro: string;
      createdAt: string;
      seen: boolean;
    }>;
  };

  return data["hydra:member"] ?? [];
}

// Fetches a single message by ID and returns clean readable text.
async function fetchMessage(
  base: string,
  jwt: string,
  messageId: string,
): Promise<{ from: string; subject: string; date: string; body: string }> {
  const res = await fetch(`${base}/messages/${messageId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    },
    signal: withTimeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`GET /messages/${messageId} HTTP ${res.status}`);

  const data = (await res.json()) as {
    from?: { address?: string; name?: string };
    subject?: string;
    createdAt?: string;
    text?: string;
    html?: string[];
  };

  // Prefer plain text; fall back to extracting readable content from HTML.
  let body: string;
  if (data.text?.trim()) {
    body = cleanText(data.text);
  } else if (data.html?.length) {
    const html = data.html.join("\n");
    const { text } = extractReadableContent(html, base);
    body = text;
  } else {
    body = "(no body)";
  }

  const fromParts = [data.from?.name, data.from?.address].filter(Boolean);
  return {
    from: fromParts.join(" ") || "unknown",
    subject: data.subject ?? "(no subject)",
    date: data.createdAt ?? "",
    body,
  };
}

// ── Action: create ────────────────────────────────────────────────────────────

async function actionCreate(): Promise<string> {
  const providers: Array<{ name: "mailtm" | "mailgw"; base: string }> = [
    { name: "mailtm", base: MAILTM_BASE },
    { name: "mailgw", base: MAILGW_BASE },
  ];

  const errors: string[] = [];

  for (const { name, base } of providers) {
    try {
      const domain = await fetchDomain(base);
      const localPart = randomString(12);
      const address = `${localPart}@${domain}`;
      // Use a random password — we only ever need it once to get the JWT.
      const password = randomString(20);

      await createAccount(base, address, password);
      const jwt = await getToken(base, address, password);
      const token = encodeToken(name, jwt);

      return [
        `Inbox created via ${name}.`,
        `Address : ${address}`,
        `Token   : ${token}`,
        "",
        "Pass the token to temp_email list/read to poll for messages.",
        "Store it with write_file — it cannot be recovered if lost.",
        "Emails are retained for a short time (typically 1 hour). Act promptly.",
      ].join("\n");
    } catch (err) {
      errors.push(`${name}: ${errMessage(err)}`);
    }
  }

  return [
    "Failed to create a temp inbox.",
    `Attempts: ${errors.join(" | ")}`,
  ].join("\n");
}

// ── Action: list ──────────────────────────────────────────────────────────────

async function actionList(token: string): Promise<string> {
  const { base, jwt } = decodeToken(token);
  const messages = await fetchMessages(base, jwt);

  if (messages.length === 0) {
    return "Inbox is empty. Wait a moment and try again — email delivery can take 10–60 seconds.";
  }

  const lines = messages.map((m, i) => {
    const date = m.createdAt ? new Date(m.createdAt).toISOString() : "";
    const status = m.seen ? "read" : "unread";
    return [
      `${i + 1}. [${status}] ${m.subject || "(no subject)"}`,
      `   From    : ${m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address}`,
      `   Date    : ${date}`,
      `   Snippet : ${cleanText(m.intro).slice(0, 120)}`,
      `   ID      : ${m.id}`,
    ].join("\n");
  });

  return [`${messages.length} message(s) in inbox:`, "", ...lines].join("\n");
}

// ── Action: read ──────────────────────────────────────────────────────────────

async function actionRead(token: string, messageId: string): Promise<string> {
  const { base, jwt } = decodeToken(token);
  const { from, subject, date, body } = await fetchMessage(base, jwt, messageId);

  return [
    `From    : ${from}`,
    `Subject : ${subject}`,
    `Date    : ${date}`,
    "",
    body,
  ].join("\n");
}

// ── Tool export ───────────────────────────────────────────────────────────────

export const tempEmailTool: ToolDefinition = {
  name: "temp_email",

  description:
    "Manage a disposable email inbox for autonomous account signups. " +
    "Use 'create' to generate a fresh throwaway address (no signup required), " +
    "'list' to poll for incoming messages, and 'read' to get the full body of a message. " +
    "Typical flow: create inbox → use address to register on a service → " +
    "list until the verification email appears → read it → extract the link or code.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "read"],
        description:
          "'create' — create a new inbox (no other params needed). " +
          "'list' — list messages in an inbox (requires token). " +
          "'read' — read a specific message (requires token + message_id).",
      },
      token: {
        type: "string",
        description:
          "The opaque token returned by 'create'. Required for 'list' and 'read'.",
      },
      message_id: {
        type: "string",
        description: "The message ID returned by 'list'. Required for 'read'.",
      },
    },
    required: ["action"],
  },

  async execute(args): Promise<string> {
    const action = String(args["action"] ?? "").trim();
    const token = String(args["token"] ?? "").trim();
    const messageId = String(args["message_id"] ?? "").trim();

    process.stderr.write(`\x1b[33m[temp_email]\x1b[0m ${action}\n`);

    try {
      switch (action) {
        case "create":
          return await actionCreate();

        case "list":
          if (!token) return "Error: 'token' is required for action 'list'.";
          return await actionList(token);

        case "read":
          if (!token) return "Error: 'token' is required for action 'read'.";
          if (!messageId) return "Error: 'message_id' is required for action 'read'.";
          return await actionRead(token, messageId);

        default:
          return `Error: unknown action '${action}'. Valid actions: create, list, read.`;
      }
    } catch (err) {
      return `Error: ${errMessage(err)}`;
    }
  },
};
