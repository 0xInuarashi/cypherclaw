// tools/web-action.ts
// -------------------
// Browser automation via Steel sessions + Playwright CDP.
//
// Why this exists alongside web_fetch:
//   web_fetch is for reading page content.
//   web_action is for interactive tasks: opening pages, clicking buttons,
//   filling forms, waiting for content, and extracting updated text.

import dns from "node:dns/promises";
import net from "node:net";
import type { Browser, BrowserContext, Page, Response as PlaywrightResponse } from "playwright-core";
import type { ToolDefinition } from "./types.js";

const STEEL_API_BASE_URL = "https://api.steel.dev/v1/sessions";
const STEEL_CONNECT_BASE_URL = "wss://connect.steel.dev";
const CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_ACTION_TIMEOUT_MS = 20_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 45_000;
const DEFAULT_SESSION_TIMEOUT_MS = 180_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const POST_ACTION_SETTLE_MS = 1_000;
const MAX_OUTPUT_CHARS = 16_000;
const INTERACTIVE_ELEMENT_LIMIT = 24;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "::",
  "::1",
  "host.docker.internal",
  "metadata.google.internal",
]);

const ACTIONS = [
  "open",
  "get_state",
  "click",
  "type",
  "press",
  "wait_for",
  "extract_text",
  "select_option",
  "check",
  "uncheck",
  "scroll",
  "hover",
  "back",
  "forward",
  "reload",
  "close_session",
] as const;

type ActionName = (typeof ACTIONS)[number];

type SteelConfig = {
  apiKey: string;
  useProxy: boolean;
  solveCaptcha: boolean;
  blockAds: boolean;
  idleTimeoutMs: number;
  sessionTimeoutMs: number;
};

type SteelSessionMeta = {
  id: string;
  sessionViewerUrl?: string;
  debugUrl?: string;
  useProxy: boolean;
  solveCaptcha: boolean;
};

type ActiveSession = {
  meta: SteelSessionMeta;
  browser: Browser;
  context: BrowserContext;
  idleTimer: ReturnType<typeof setTimeout> | null;
  page: Page;
  lastResponseStatus: number | null;
  releasing: boolean;
};

type InteractiveElement = {
  selector: string;
  description: string;
};

type PageSnapshot = {
  currentUrl: string;
  title: string;
  text: string;
  interactiveElements: InteractiveElement[];
};

const activeSessions = new Map<string, ActiveSession>();

let playwrightModulePromise: Promise<typeof import("playwright-core")> | null = null;

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
    throw new Error(`Refusing to open a local or internal host: ${hostname}`);
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Refusing to open a private or loopback address: ${hostname}`);
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
    throw new Error(`Refusing to open ${hostname} because it resolves to a private or loopback address.`);
  }

  return url;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function parseNumberEnv(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

function getSteelConfig(): SteelConfig {
  const apiKey = process.env.STEEL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing STEEL_API_KEY. Set it in the environment before using web_action.");
  }

  return {
    apiKey,
    useProxy: parseBooleanEnv("STEEL_USE_PROXY", true),
    solveCaptcha: parseBooleanEnv("STEEL_SOLVE_CAPTCHA", true),
    blockAds: parseBooleanEnv("STEEL_BLOCK_ADS", true),
    idleTimeoutMs: parseNumberEnv("STEEL_IDLE_TIMEOUT_MS", DEFAULT_IDLE_TIMEOUT_MS),
    sessionTimeoutMs: parseNumberEnv("STEEL_SESSION_TIMEOUT_MS", DEFAULT_SESSION_TIMEOUT_MS),
  };
}

function readNumberArg(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
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

function truncateOutput(text: string, limit = MAX_OUTPUT_CHARS): { text: string; omitted: number } {
  if (text.length <= limit) {
    return { text, omitted: 0 };
  }

  return {
    text: text.slice(0, limit),
    omitted: text.length - limit,
  };
}

function ensureAction(value: unknown): ActionName {
  const action = String(value ?? "").trim() as ActionName;
  if ((ACTIONS as readonly string[]).includes(action)) {
    return action;
  }
  throw new Error(`Unknown action "${String(value ?? "")}".`);
}

function requireNonEmptyString(value: unknown, name: string): string {
  const stringValue = String(value ?? "").trim();
  if (!stringValue) {
    throw new Error(`Missing required argument '${name}'.`);
  }
  return stringValue;
}

async function getPlaywright(): Promise<typeof import("playwright-core")> {
  if (!playwrightModulePromise) {
    playwrightModulePromise = import("playwright-core").catch(() => {
      throw new Error(
        "Missing dependency 'playwright-core'. Install project dependencies before using web_action.",
      );
    });
  }

  return playwrightModulePromise;
}

async function createSteelSessionAttempt(
  config: SteelConfig,
  attempt: Pick<SteelConfig, "useProxy" | "solveCaptcha">,
): Promise<SteelSessionMeta> {
  const res = await fetch(STEEL_API_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "steel-api-key": config.apiKey,
    },
    body: JSON.stringify({
      useProxy: attempt.useProxy,
      solveCaptcha: attempt.solveCaptcha,
      blockAds: config.blockAds,
      sessionTimeout: config.sessionTimeoutMs,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Steel session creation failed (${res.status}): ${body}`);
  }

  const session = (await res.json()) as Partial<{
    id: string;
    sessionViewerUrl: string;
    debugUrl: string;
  }>;

  if (!session.id) {
    throw new Error("Steel session creation returned no session id.");
  }

  return {
    id: session.id,
    sessionViewerUrl: session.sessionViewerUrl,
    debugUrl: session.debugUrl,
    useProxy: attempt.useProxy,
    solveCaptcha: attempt.solveCaptcha,
  };
}

async function createSteelSession(config: SteelConfig): Promise<SteelSessionMeta> {
  const attempts: Array<Pick<SteelConfig, "useProxy" | "solveCaptcha">> = [];
  const seen = new Set<string>();

  const pushAttempt = (attempt: Pick<SteelConfig, "useProxy" | "solveCaptcha">) => {
    const key = `${attempt.useProxy}:${attempt.solveCaptcha}`;
    if (!seen.has(key)) {
      seen.add(key);
      attempts.push(attempt);
    }
  };

  pushAttempt({ useProxy: config.useProxy, solveCaptcha: config.solveCaptcha });
  pushAttempt({ useProxy: false, solveCaptcha: config.solveCaptcha });
  pushAttempt({ useProxy: false, solveCaptcha: false });

  let lastError: Error | null = null;

  for (const attempt of attempts) {
    try {
      return await createSteelSessionAttempt(config, attempt);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("Steel session creation failed.");
}

async function releaseSteelSession(apiKey: string, sessionId: string): Promise<void> {
  const res = await fetch(`${STEEL_API_BASE_URL}/${sessionId}/release`, {
    method: "POST",
    headers: {
      "steel-api-key": apiKey,
    },
  });

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Steel session release failed (${res.status}): ${body}`);
  }
}

function buildSteelConnectUrl(apiKey: string, sessionId: string): string {
  const params = new URLSearchParams({
    apiKey,
    sessionId,
  });

  return `${STEEL_CONNECT_BASE_URL}?${params.toString()}`;
}

async function connectToSteelSession(
  config: SteelConfig,
  meta: SteelSessionMeta,
): Promise<ActiveSession> {
  const { chromium } = await getPlaywright();
  const browser = await chromium.connectOverCDP(buildSteelConnectUrl(config.apiKey, meta.id), {
    timeout: CONNECT_TIMEOUT_MS,
  });

  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw new Error("Steel returned no default browser context.");
  }

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT_MS);

  return {
    meta,
    browser,
    context,
    idleTimer: null,
    page,
    lastResponseStatus: null,
    releasing: false,
  };
}

async function getOrReconnectSession(sessionId: string, config: SteelConfig): Promise<ActiveSession> {
  const existing = activeSessions.get(sessionId);
  if (existing && existing.browser.isConnected()) {
    return existing;
  }

  const meta = existing?.meta ?? {
    id: sessionId,
    useProxy: config.useProxy,
    solveCaptcha: config.solveCaptcha,
  };

  const reconnected = await connectToSteelSession(config, meta);
  activeSessions.set(sessionId, reconnected);
  return reconnected;
}

async function createManagedSession(config: SteelConfig): Promise<ActiveSession> {
  const meta = await createSteelSession(config);
  const active = await connectToSteelSession(config, meta);
  activeSessions.set(meta.id, active);
  return active;
}

async function closeManagedSession(sessionId: string, config: SteelConfig): Promise<void> {
  const existing = activeSessions.get(sessionId);
  if (existing) {
    if (existing.releasing) {
      return;
    }

    existing.releasing = true;
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }

    activeSessions.delete(sessionId);
    await existing.browser.close().catch(() => {});
  }

  await releaseSteelSession(config.apiKey, sessionId).catch(() => {});
}

function clearIdleRelease(active: ActiveSession): void {
  if (active.idleTimer) {
    clearTimeout(active.idleTimer);
    active.idleTimer = null;
  }
}

function scheduleIdleRelease(active: ActiveSession, config: SteelConfig): void {
  clearIdleRelease(active);

  if (active.releasing) {
    return;
  }

  active.idleTimer = setTimeout(() => {
    process.stderr.write(
      `\x1b[33m[web_action]\x1b[0m auto-releasing idle session ${active.meta.id} after ${config.idleTimeoutMs}ms\n`,
    );
    void closeManagedSession(active.meta.id, config);
  }, config.idleTimeoutMs);
}

async function withSessionLease<T>(
  active: ActiveSession,
  config: SteelConfig,
  work: () => Promise<T>,
): Promise<T> {
  clearIdleRelease(active);

  try {
    return await work();
  } finally {
    if (activeSessions.get(active.meta.id) === active && active.browser.isConnected() && !active.releasing) {
      scheduleIdleRelease(active, config);
    }
  }
}

function getCurrentPage(active: ActiveSession): Page {
  if (!active.page.isClosed()) {
    return active.page;
  }

  const pages = active.context.pages().filter((page) => !page.isClosed());
  if (!pages.length) {
    throw new Error(`Steel session ${active.meta.id} has no open pages.`);
  }

  active.page = pages[pages.length - 1]!;
  return active.page;
}

async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
  await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(POST_ACTION_SETTLE_MS);
}

async function extractPageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector("main, article, [role='main']");
    const candidates = [
      main instanceof HTMLElement ? main.innerText : "",
      document.body?.innerText ?? "",
      document.documentElement?.innerText ?? "",
    ];

    return candidates.find((candidate) => candidate.trim().length > 0) ?? "";
  });
}

async function extractInteractiveElements(page: Page): Promise<InteractiveElement[]> {
  return page.evaluate((limit) => {
    const compact = (value: string, max = 80): string =>
      value.replace(/\s+/g, " ").trim().slice(0, max);

    const escapeAttr = (value: string): string =>
      value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const isVisible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const selectorFor = (element: HTMLElement): string => {
      const tag = element.tagName.toLowerCase();
      const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");
      if (testId) {
        const attrName = element.hasAttribute("data-testid") ? "data-testid" : "data-test";
        return `[${attrName}="${escapeAttr(testId)}"]`;
      }

      const id = element.getAttribute("id");
      if (id) return `${tag}[id="${escapeAttr(id)}"]`;

      const name = element.getAttribute("name");
      if (name) return `${tag}[name="${escapeAttr(name)}"]`;

      const ariaLabel = compact(element.getAttribute("aria-label") ?? "", 60);
      if (ariaLabel) return `${tag}[aria-label="${escapeAttr(ariaLabel)}"]`;

      const placeholder = compact(element.getAttribute("placeholder") ?? "", 60);
      if (placeholder) return `${tag}[placeholder="${escapeAttr(placeholder)}"]`;

      const role = element.getAttribute("role");
      if (role) return `[role="${escapeAttr(role)}"]`;

      const text = compact(element.innerText || element.textContent || "", 60);
      if (text) return `text=${JSON.stringify(text)}`;

      return tag;
    };

    const descriptionFor = (element: HTMLElement): string => {
      const tag = element.tagName.toLowerCase();
      const parts = [tag];

      const type = compact(element.getAttribute("type") ?? "", 30);
      if (type) parts.push(`type=${type}`);

      const name = compact(element.getAttribute("name") ?? "", 30);
      if (name) parts.push(`name=${name}`);

      const ariaLabel = compact(element.getAttribute("aria-label") ?? "", 40);
      if (ariaLabel) parts.push(`aria-label="${ariaLabel}"`);

      const placeholder = compact(element.getAttribute("placeholder") ?? "", 40);
      if (placeholder) parts.push(`placeholder="${placeholder}"`);

      const text = compact(element.innerText || element.textContent || "", 50);
      if (text) parts.push(`text="${text}"`);

      return parts.join(" · ");
    };

    const selectors = new Set<string>();
    const results: Array<{ selector: string; description: string }> = [];
    const elements = Array.from(
      document.querySelectorAll(
        "a, button, input, textarea, select, [role='button'], [role='link'], [contenteditable='true'], [data-testid], [aria-label]",
      ),
    );

    for (const element of elements) {
      if (!isVisible(element)) continue;

      const selector = selectorFor(element);
      const description = descriptionFor(element);
      const dedupeKey = `${selector}::${description}`;

      if (selectors.has(dedupeKey)) continue;
      selectors.add(dedupeKey);
      results.push({ selector, description });

      if (results.length >= limit) break;
    }

    return results;
  }, INTERACTIVE_ELEMENT_LIMIT);
}

async function collectPageSnapshot(page: Page): Promise<PageSnapshot> {
  const [title, text, interactiveElements] = await Promise.all([
    page.title().catch(() => ""),
    extractPageText(page).catch(() => ""),
    extractInteractiveElements(page).catch(() => [] as InteractiveElement[]),
  ]);

  return {
    currentUrl: page.url(),
    title: cleanText(title) || "(untitled)",
    text: cleanText(text) || "(empty page)",
    interactiveElements,
  };
}

function formatSessionLines(active: ActiveSession): string[] {
  const lines = [
    `Session ID: ${active.meta.id}`,
    `Proxy Enabled: ${active.meta.useProxy ? "yes" : "no"}`,
    `CAPTCHA Solving Enabled: ${active.meta.solveCaptcha ? "yes" : "no"}`,
  ];

  if (active.meta.sessionViewerUrl) {
    lines.push(`Session Viewer URL: ${active.meta.sessionViewerUrl}`);
  }

  if (active.meta.debugUrl) {
    lines.push(`Debug URL: ${active.meta.debugUrl}`);
  }

  return lines;
}

function formatInteractiveElementLines(elements: InteractiveElement[]): string[] {
  if (!elements.length) {
    return ["Visible Interactive Elements: none found"];
  }

  return [
    "Visible Interactive Elements:",
    ...elements.map((element, index) => `${index + 1}. ${element.description} -> ${element.selector}`),
  ];
}

function formatStateOutput(
  action: ActionName,
  active: ActiveSession,
  snapshot: PageSnapshot,
  extraLines: string[] = [],
): string {
  const excerpt = truncateOutput(snapshot.text);
  const lines = [
    `Action: ${action}`,
    ...formatSessionLines(active),
    `URL: ${snapshot.currentUrl}`,
    `Title: ${snapshot.title}`,
    `HTTP Status: ${active.lastResponseStatus ?? "(unknown)"}`,
    ...extraLines,
    "",
    "Page Text:",
    excerpt.text,
    "",
    ...formatInteractiveElementLines(snapshot.interactiveElements),
  ];

  if (excerpt.omitted > 0) {
    lines.push("");
    lines.push(`[output truncated — ${excerpt.omitted} chars omitted]`);
  }

  return lines.join("\n");
}

async function updatePageAfterAction(
  active: ActiveSession,
  popupPage: Page | null,
  navigationResponse: PlaywrightResponse | null,
): Promise<Page> {
  if (popupPage) {
    active.page = popupPage;
    active.lastResponseStatus = null;
    await settlePage(active.page);
    return active.page;
  }

  if (navigationResponse) {
    active.lastResponseStatus = navigationResponse.status();
  }

  active.page = getCurrentPage(active);
  await settlePage(active.page);
  return active.page;
}

async function actionOpen(
  args: Record<string, unknown>,
  config: SteelConfig,
): Promise<string> {
  const targetUrl = (await validatePublicUrl(requireNonEmptyString(args["url"], "url"))).toString();
  const sessionId = String(args["session_id"] ?? "").trim();
  const active = sessionId
    ? await getOrReconnectSession(sessionId, config)
    : await createManagedSession(config);

  return withSessionLease(active, config, async () => {
    const page = getCurrentPage(active);

    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
    });

    active.lastResponseStatus = response?.status() ?? null;
    await settlePage(page);

    const snapshot = await collectPageSnapshot(page);
    return formatStateOutput("open", active, snapshot, [`Idle Timeout: ${config.idleTimeoutMs}ms`]);
  });
}

async function requireSessionFromArgs(
  args: Record<string, unknown>,
  config: SteelConfig,
): Promise<ActiveSession> {
  const sessionId = requireNonEmptyString(args["session_id"], "session_id");
  return getOrReconnectSession(sessionId, config);
}

async function actionGetState(active: ActiveSession): Promise<string> {
  const page = getCurrentPage(active);
  const snapshot = await collectPageSnapshot(page);
  return formatStateOutput("get_state", active, snapshot);
}

async function actionClick(
  active: ActiveSession,
  args: Record<string, unknown>,
): Promise<string> {
  const selector = requireNonEmptyString(args["selector"], "selector");
  const timeoutMs = readNumberArg(args["timeout_ms"], DEFAULT_ACTION_TIMEOUT_MS);
  const page = getCurrentPage(active);
  const popupPromise = active.context.waitForEvent("page", { timeout: 2_500 }).catch(() => null);
  const navigationPromise = page.waitForNavigation({
    timeout: Math.min(timeoutMs, 5_000),
    waitUntil: "domcontentloaded",
  }).catch(() => null);

  await page.locator(selector).first().click({ timeout: timeoutMs });

  const popupPage = await popupPromise;
  const navigationResponse = popupPage ? null : await navigationPromise;
  const currentPage = await updatePageAfterAction(active, popupPage, navigationResponse);
  const snapshot = await collectPageSnapshot(currentPage);
  return formatStateOutput("click", active, snapshot, [`Selector: ${selector}`]);
}

async function actionType(
  active: ActiveSession,
  args: Record<string, unknown>,
): Promise<string> {
  const selector = requireNonEmptyString(args["selector"], "selector");
  const text = requireNonEmptyString(args["text"], "text");
  const timeoutMs = readNumberArg(args["timeout_ms"], DEFAULT_ACTION_TIMEOUT_MS);
  const page = getCurrentPage(active);

  await page.locator(selector).first().fill(text, { timeout: timeoutMs });
  await settlePage(page);

  const snapshot = await collectPageSnapshot(page);
  return formatStateOutput("type", active, snapshot, [`Selector: ${selector}`, `Typed: [redacted ${text.length} chars]`]);
}

async function actionPress(
  active: ActiveSession,
  args: Record<string, unknown>,
): Promise<string> {
  const key = requireNonEmptyString(args["key"], "key");
  const selector = String(args["selector"] ?? "").trim();
  const timeoutMs = readNumberArg(args["timeout_ms"], DEFAULT_ACTION_TIMEOUT_MS);
  const page = getCurrentPage(active);

  if (selector) {
    await page.locator(selector).first().focus({ timeout: timeoutMs });
  }

  const navigationPromise = page.waitForNavigation({
    timeout: Math.min(timeoutMs, 5_000),
    waitUntil: "domcontentloaded",
  }).catch(() => null);

  await page.keyboard.press(key);
  const navigationResponse = await navigationPromise;
  const currentPage = await updatePageAfterAction(active, null, navigationResponse);
  const snapshot = await collectPageSnapshot(currentPage);
  return formatStateOutput("press", active, snapshot, [`Key: ${key}`]);
}

async function actionWaitFor(
  active: ActiveSession,
  args: Record<string, unknown>,
): Promise<string> {
  const selector = requireNonEmptyString(args["selector"], "selector");
  const timeoutMs = readNumberArg(args["timeout_ms"], DEFAULT_ACTION_TIMEOUT_MS);
  const page = getCurrentPage(active);

  await page.locator(selector).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  });

  await settlePage(page);
  const snapshot = await collectPageSnapshot(page);
  return formatStateOutput("wait_for", active, snapshot, [`Waited For: ${selector}`]);
}

async function actionExtractText(
  active: ActiveSession,
  args: Record<string, unknown>,
): Promise<string> {
  const selector = String(args["selector"] ?? "").trim();
  const timeoutMs = readNumberArg(args["timeout_ms"], DEFAULT_ACTION_TIMEOUT_MS);
  const maxChars = readNumberArg(args["max_chars"], MAX_OUTPUT_CHARS);
  const page = getCurrentPage(active);

  let text: string;
  if (selector) {
    const locator = page.locator(selector).first();
    text = cleanText(
      (await locator.innerText({ timeout: timeoutMs }).catch(async () => {
        const fallback = await locator.textContent({ timeout: timeoutMs });
        return fallback ?? "";
      })) || "",
    );
  } else {
    text = cleanText(await extractPageText(page));
  }

  const excerpt = truncateOutput(text, Math.max(1, Math.min(maxChars, MAX_OUTPUT_CHARS)));
  const lines = [
    "Action: extract_text",
    ...formatSessionLines(active),
    `URL: ${page.url()}`,
  ];

  if (selector) {
    lines.push(`Selector: ${selector}`);
  }

  lines.push("", excerpt.text || "(empty text)");

  if (excerpt.omitted > 0) {
    lines.push("");
    lines.push(`[output truncated — ${excerpt.omitted} chars omitted]`);
  }

  return lines.join("\n");
}

async function actionSelectOption(
  active: ActiveSession,
  args: Record<string, unknown>,
): Promise<string> {
  const selector = requireNonEmptyString(args["selector"], "selector");
  const value = requireNonEmptyString(args["value"], "value");
  const timeoutMs = readNumberArg(args["timeout_ms"], DEFAULT_ACTION_TIMEOUT_MS);
  const page = getCurrentPage(active);
  const locator = page.locator(selector).first();

  try {
    await locator.selectOption(value, { timeout: timeoutMs });
  } catch {
    await locator.selectOption({ label: value }, { timeout: timeoutMs });
  }

  await settlePage(page);
  const snapshot = await collectPageSnapshot(page);
  return formatStateOutput("select_option", active, snapshot, [`Selector: ${selector}`, `Value: ${value}`]);
}

async function actionCheck(
  active: ActiveSession,
  args: Record<string, unknown>,
  checked: boolean,
): Promise<string> {
  const selector = requireNonEmptyString(args["selector"], "selector");
  const timeoutMs = readNumberArg(args["timeout_ms"], DEFAULT_ACTION_TIMEOUT_MS);
  const page = getCurrentPage(active);
  const locator = page.locator(selector).first();

  if (checked) {
    await locator.check({ timeout: timeoutMs });
  } else {
    await locator.uncheck({ timeout: timeoutMs });
  }

  await settlePage(page);
  const snapshot = await collectPageSnapshot(page);
  return formatStateOutput(checked ? "check" : "uncheck", active, snapshot, [`Selector: ${selector}`]);
}

async function actionScroll(
  active: ActiveSession,
  args: Record<string, unknown>,
): Promise<string> {
  const selector = String(args["selector"] ?? "").trim();
  const amount = readNumberArg(args["value"], 800);
  const page = getCurrentPage(active);

  if (selector) {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
  } else {
    await page.evaluate((scrollAmount) => {
      window.scrollBy(0, scrollAmount);
    }, amount);
  }

  await settlePage(page);
  const snapshot = await collectPageSnapshot(page);
  return formatStateOutput("scroll", active, snapshot, selector ? [`Selector: ${selector}`] : [`Scroll Amount: ${amount}`]);
}

async function actionHover(
  active: ActiveSession,
  args: Record<string, unknown>,
): Promise<string> {
  const selector = requireNonEmptyString(args["selector"], "selector");
  const timeoutMs = readNumberArg(args["timeout_ms"], DEFAULT_ACTION_TIMEOUT_MS);
  const page = getCurrentPage(active);

  await page.locator(selector).first().hover({ timeout: timeoutMs });
  await settlePage(page);

  const snapshot = await collectPageSnapshot(page);
  return formatStateOutput("hover", active, snapshot, [`Selector: ${selector}`]);
}

async function actionHistoryNavigation(
  active: ActiveSession,
  action: "back" | "forward" | "reload",
): Promise<string> {
  const page = getCurrentPage(active);
  let response: PlaywrightResponse | null = null;

  if (action === "back") {
    response = await page.goBack({ timeout: DEFAULT_NAVIGATION_TIMEOUT_MS, waitUntil: "domcontentloaded" });
  } else if (action === "forward") {
    response = await page.goForward({ timeout: DEFAULT_NAVIGATION_TIMEOUT_MS, waitUntil: "domcontentloaded" });
  } else {
    response = await page.reload({ timeout: DEFAULT_NAVIGATION_TIMEOUT_MS, waitUntil: "domcontentloaded" });
  }

  active.lastResponseStatus = response?.status() ?? active.lastResponseStatus;
  await settlePage(page);

  const snapshot = await collectPageSnapshot(page);
  return formatStateOutput(action, active, snapshot);
}

async function actionCloseSession(
  args: Record<string, unknown>,
  config: SteelConfig,
): Promise<string> {
  const sessionId = requireNonEmptyString(args["session_id"], "session_id");
  await closeManagedSession(sessionId, config);
  return `Action: close_session\nSession ID: ${sessionId}\nReleased: yes`;
}

export const webActionTool: ToolDefinition = {
  name: "web_action",
  description:
    "Drive a real browser session hosted by Steel for interactive web tasks. " +
    "Use action=open with a public URL to start a session, then reuse the returned session_id with " +
    "actions like get_state, click, type, wait_for, extract_text, and close_session. " +
    "Selectors use Playwright syntax. Prefer calling get_state after open to inspect suggested selectors.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "The browser action to perform.",
        enum: [...ACTIONS],
      },
      session_id: {
        type: "string",
        description: "Existing Steel session id to reuse. Required for every action except open.",
      },
      url: {
        type: "string",
        description: "Public http:// or https:// URL. Required for action=open.",
      },
      selector: {
        type: "string",
        description: "Playwright selector for the target element, such as text=\"Log in\" or input[name=\"email\"].",
      },
      text: {
        type: "string",
        description: "Text to type for action=type.",
      },
      key: {
        type: "string",
        description: "Keyboard key for action=press, such as Enter, Tab, or Escape.",
      },
      value: {
        type: "string",
        description: "Value used by select_option or scroll amount in pixels for action=scroll.",
      },
      timeout_ms: {
        type: "number",
        description: "Optional timeout override in milliseconds for element and action waits.",
      },
      max_chars: {
        type: "number",
        description: "Optional max characters to return for action=extract_text.",
      },
    },
    required: ["action"],
  },

  async execute(args): Promise<string> {
    const action = ensureAction(args["action"]);
    process.stderr.write(`\x1b[33m[web_action]\x1b[0m ${action}\n`);

    try {
      const config = getSteelConfig();

      switch (action) {
        case "open":
          return await actionOpen(args, config);

        case "get_state": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionGetState(active));
        }

        case "click": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionClick(active, args));
        }

        case "type": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionType(active, args));
        }

        case "press": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionPress(active, args));
        }

        case "wait_for": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionWaitFor(active, args));
        }

        case "extract_text": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionExtractText(active, args));
        }

        case "select_option": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionSelectOption(active, args));
        }

        case "check": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionCheck(active, args, true));
        }

        case "uncheck": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionCheck(active, args, false));
        }

        case "scroll": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionScroll(active, args));
        }

        case "hover": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionHover(active, args));
        }

        case "back": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionHistoryNavigation(active, "back"));
        }

        case "forward": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionHistoryNavigation(active, "forward"));
        }

        case "reload": {
          const active = await requireSessionFromArgs(args, config);
          return await withSessionLease(active, config, () => actionHistoryNavigation(active, "reload"));
        }

        case "close_session":
          return await actionCloseSession(args, config);
      }

      return `Error performing web action: unsupported action ${action}`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error performing web action: ${error.message ?? String(err)}`;
    }
  },
};
