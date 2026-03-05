// tools/web-fetch.ts
// ------------------
// Fetches a public HTTP(S) URL through a Browserbase-hosted browser session.
// This is intentionally browser-based rather than raw HTTP because many sites
// now block simple scripted fetches while still allowing real browsers.

import dns from "node:dns/promises";
import net from "node:net";
import type { Response as PlaywrightResponse } from "playwright-core";
import type { ToolDefinition } from "./types.js";

const BROWSERBASE_API_URL = "https://api.browserbase.com/v1/sessions";
const SESSION_TIMEOUT_SECONDS = 180;
const CONNECT_TIMEOUT_MS = 30_000;
const NAVIGATION_TIMEOUT_MS = 45_000;
const LOAD_SETTLE_TIMEOUT_MS = 5_000;
const INITIAL_SETTLE_MS = 2_000;
const CHALLENGE_SETTLE_MS = 8_000;
const MAX_OUTPUT_CHARS = 16_000;

const BOT_BLOCK_MARKERS = [
  "access denied",
  "are you human",
  "bot detection",
  "captcha",
  "cf-challenge",
  "checking your browser",
  "ddos protection",
  "enable javascript",
  "just a moment",
  "please verify",
  "press and hold",
  "security check",
  "verify you are human",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "::",
  "::1",
  "host.docker.internal",
  "metadata.google.internal",
]);

type BrowserbaseSession = {
  id: string;
  projectId: string;
  connectUrl: string;
};

type BrowserbaseConfig = {
  apiKey: string;
  projectId: string;
  useProxy: boolean;
  useAdvancedStealth: boolean;
};

type PageSnapshot = {
  contentType: string;
  finalUrl: string;
  status: number | null;
  text: string;
  title: string;
};

function isPrivateIPv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;

  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return net.isIPv4(mapped) ? isPrivateIPv4(mapped) : false;
  }

  return false;
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    return isPrivateIPv4(address);
  }
  if (net.isIPv6(address)) {
    return isPrivateIPv6(address);
  }
  return false;
}

async function validatePublicUrl(input: string): Promise<URL> {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}. Only http:// and https:// are allowed.`);
  }

  const hostname = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error(`Refusing to fetch a local or internal host: ${hostname}`);
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Refusing to fetch a private or loopback address: ${hostname}`);
    }
    return url;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err: unknown) {
    const error = err as { message?: string };
    throw new Error(`Could not resolve hostname ${hostname}: ${error.message ?? String(err)}`);
  }

  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error(`Refusing to fetch ${hostname} because it resolves to a private or loopback address.`);
  }

  return url;
}

function getBrowserbaseConfig(): BrowserbaseConfig {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing BROWSERBASE_API_KEY. Set it in the environment before using web_fetch.");
  }

  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("Missing BROWSERBASE_PROJECT_ID. Set it in the environment before using web_fetch.");
  }

  const useProxy = process.env.BROWSERBASE_USE_PROXY !== "false";
  const useAdvancedStealth = process.env.BROWSERBASE_ADVANCED_STEALTH === "true";

  return {
    apiKey,
    projectId,
    useProxy,
    useAdvancedStealth,
  };
}

function cleanText(input: string): string {
  return input
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateOutput(text: string): { text: string; omitted: number } {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return { text, omitted: 0 };
  }

  return {
    text: text.slice(0, MAX_OUTPUT_CHARS),
    omitted: text.length - MAX_OUTPUT_CHARS,
  };
}

function looksLikeBotBlock(title: string, text: string): boolean {
  const haystack = `${title}\n${text}`.toLowerCase();
  return BOT_BLOCK_MARKERS.some((marker) => haystack.includes(marker));
}

async function createBrowserbaseSession(
  config: BrowserbaseConfig,
  useProxy: boolean,
): Promise<BrowserbaseSession> {
  const browserSettings: Record<string, unknown> = {
    blockAds: true,
    solveCaptchas: true,
    logSession: false,
    recordSession: false,
  };

  if (config.useAdvancedStealth) {
    browserSettings["advancedStealth"] = true;
    browserSettings["os"] = "windows";
  }

  const body: Record<string, unknown> = {
    projectId: config.projectId,
    timeout: SESSION_TIMEOUT_SECONDS,
    browserSettings,
    userMetadata: {
      source: "cypherclaw.web_fetch",
    },
  };

  if (useProxy) {
    body["proxies"] = true;
  }

  const res = await fetch(BROWSERBASE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": config.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const responseText = await res.text();
    throw new Error(`Browserbase session creation failed (${res.status}): ${responseText}`);
  }

  const session = (await res.json()) as Partial<BrowserbaseSession>;

  if (!session.id || !session.projectId || !session.connectUrl) {
    throw new Error("Browserbase session creation returned an incomplete response.");
  }

  return {
    id: session.id,
    projectId: session.projectId,
    connectUrl: session.connectUrl,
  };
}

async function createBrowserbaseSessionWithFallback(config: BrowserbaseConfig): Promise<{
  proxyEnabled: boolean;
  session: BrowserbaseSession;
}> {
  try {
    return {
      proxyEnabled: config.useProxy,
      session: await createBrowserbaseSession(config, config.useProxy),
    };
  } catch (err: unknown) {
    if (!config.useProxy) {
      throw err;
    }

    const proxyError = err as { message?: string };

    try {
      return {
        proxyEnabled: false,
        session: await createBrowserbaseSession(config, false),
      };
    } catch {
      throw new Error(
        `Browserbase session creation failed with proxies enabled: ${proxyError.message ?? String(err)}`,
      );
    }
  }
}

async function releaseBrowserbaseSession(apiKey: string, session: BrowserbaseSession): Promise<void> {
  const res = await fetch(`${BROWSERBASE_API_URL}/${session.id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": apiKey,
    },
    body: JSON.stringify({
      projectId: session.projectId,
      status: "REQUEST_RELEASE",
    }),
  });

  if (!res.ok) {
    const responseText = await res.text();
    throw new Error(`Browserbase session release failed (${res.status}): ${responseText}`);
  }
}

async function settlePage(page: import("playwright-core").Page): Promise<void> {
  await page.waitForLoadState("load", { timeout: LOAD_SETTLE_TIMEOUT_MS }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: LOAD_SETTLE_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(INITIAL_SETTLE_MS);
}

async function extractPageText(page: import("playwright-core").Page): Promise<string> {
  return page.evaluate(() => {
    const primary = document.querySelector("main, article, [role='main']");
    const candidates = [
      primary instanceof HTMLElement ? primary.innerText : "",
      document.body?.innerText ?? "",
      document.documentElement?.innerText ?? "",
    ];

    return candidates.find((candidate) => candidate.trim().length > 0) ?? "";
  });
}

async function collectSnapshot(
  page: import("playwright-core").Page,
  response: PlaywrightResponse | null,
): Promise<PageSnapshot> {
  const title = cleanText(await page.title().catch(() => ""));
  const text = cleanText(await extractPageText(page));
  const finalUrl = page.url();
  const contentType = response?.headers()["content-type"] ?? "(unknown)";

  return {
    contentType,
    finalUrl,
    status: response?.status() ?? null,
    text: text || "(empty page)",
    title: title || "(untitled)",
  };
}

async function fetchWithBrowserbase(url: string, config: BrowserbaseConfig): Promise<string> {
  let playwright: typeof import("playwright-core");
  try {
    playwright = await import("playwright-core");
  } catch {
    throw new Error(
      "Missing dependency 'playwright-core'. Install project dependencies before using web_fetch.",
    );
  }

  const { chromium } = playwright;

  let session: BrowserbaseSession | null = null;
  let browser: import("playwright-core").Browser | null = null;
  let proxyEnabled = false;

  try {
    const created = await createBrowserbaseSessionWithFallback(config);
    session = created.session;
    proxyEnabled = created.proxyEnabled;

    browser = await chromium.connectOverCDP(session.connectUrl, {
      timeout: CONNECT_TIMEOUT_MS,
    });

    const defaultContext = browser.contexts()[0];
    if (!defaultContext) {
      throw new Error("Browserbase returned no default browser context.");
    }

    const page = defaultContext.pages()[0] ?? (await defaultContext.newPage());

    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    let response: PlaywrightResponse | null = null;
    let navigationWarning: string | undefined;

    try {
      response = await page.goto(url, {
        timeout: NAVIGATION_TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      });
    } catch (err: unknown) {
      const error = err as { message?: string };
      navigationWarning = error.message ?? String(err);
    }

    await settlePage(page);

    let snapshot = await collectSnapshot(page, response);
    let botBlocked = looksLikeBotBlock(snapshot.title, snapshot.text);

    if (botBlocked) {
      await page.waitForTimeout(CHALLENGE_SETTLE_MS);
      snapshot = await collectSnapshot(page, response);
      botBlocked = looksLikeBotBlock(snapshot.title, snapshot.text);
    }

    const truncated = truncateOutput(snapshot.text);
    const lines = [
      `Requested URL: ${url}`,
      `Final URL: ${snapshot.finalUrl}`,
      `Title: ${snapshot.title}`,
      `Status: ${snapshot.status ?? "(unknown)"}`,
      `Content-Type: ${snapshot.contentType}`,
      `Browserbase session: ${session.id}`,
      `Browserbase proxy: ${proxyEnabled ? "enabled" : "disabled"}`,
      `Bot protection detected: ${botBlocked ? "likely" : "not detected"}`,
    ];

    if (navigationWarning) {
      lines.push(`Navigation warning: ${navigationWarning}`);
    }

    lines.push("");
    lines.push(truncated.text);

    if (truncated.omitted > 0) {
      lines.push("");
      lines.push(`[output truncated — ${truncated.omitted} chars omitted]`);
    }

    return lines.join("\n");
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    } else if (session) {
      await releaseBrowserbaseSession(config.apiKey, session).catch(() => {});
    }
  }
}

export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description:
    "Fetch a public http:// or https:// URL using a Browserbase-hosted browser session and return the rendered page text. " +
    "Use this when normal scripted fetches are likely to be blocked.",

  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The public http:// or https:// URL to fetch.",
      },
    },
    required: ["url"],
  },

  async execute(args): Promise<string> {
    const rawUrl = String(args["url"] ?? "").trim();

    if (!rawUrl) {
      return "Error: missing required argument 'url'.";
    }

    process.stderr.write(`\x1b[33m[web_fetch]\x1b[0m ${rawUrl}\n`);

    try {
      const safeUrl = await validatePublicUrl(rawUrl);
      const config = getBrowserbaseConfig();
      return await fetchWithBrowserbase(safeUrl.toString(), config);
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error fetching URL: ${error.message ?? String(err)}`;
    }
  },
};
