// tools/web-fetch.ts
// ------------------
// Fetches a public URL and returns its main content as clean, readable text.
//
// Why no browser (Playwright/Puppeteer)?
//   web_fetch is stateless and read-only. A real browser adds 2–5 s of cold-
//   start overhead, requires cloud infra, and costs money per session. Native
//   fetch + Readability covers the vast majority of content sites. The fallback
//   tiers handle the rest — including JS-heavy SPAs.
//
// Three-tier pipeline (each tier tried only if the previous one fails):
//
//   Tier 1 — Native fetch + Readability
//     Standard HTTP request with a realistic User-Agent. The response HTML is
//     parsed by Mozilla Readability to extract only the main article/content
//     area, stripping nav menus, footers, ads, and other boilerplate.
//     Fails on: bot-detection blocks (403/429), JS-only SPAs, network errors.
//
//   Tier 2 — Jina Reader  (r.jina.ai)
//     Free service, zero config, no API key required. Internally runs a
//     headless browser, so it handles JS-rendered pages. Returns clean
//     markdown directly — no post-processing needed. Set JINA_API_KEY in
//     the environment for a higher rate limit.
//     Fails on: Jina outages, rate limits without a key.
//
//   Tier 3 — Firecrawl  (api.firecrawl.dev)
//     Paid service, highest quality, supports caching. Only attempted when
//     FIRECRAWL_API_KEY is set in the environment.
//
//   All fail → structured error returned so the model can decide next steps.

import type { ToolDefinition } from "./types.js";
import { validatePublicUrl, cleanText, truncateOutput } from "./utils/browser-utils.js";
import { extractReadableContent } from "./utils/readability.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// Per-tier network timeouts. Jina and Firecrawl are slower because they spin
// up headless browsers or hit external APIs.
const DIRECT_TIMEOUT_MS = 15_000;
const JINA_TIMEOUT_MS   = 25_000;
const FIRECRAWL_TIMEOUT_MS = 30_000;

// Maximum characters of extracted text returned to the model.
// Readability dramatically reduces page size before this cap is applied,
// so in practice most articles fit well under this limit.
const MAX_OUTPUT_CHARS = 200_000;

// Realistic desktop browser UA. Many sites return bot-walls to obvious
// scripted user agents but serve content normally to this string.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const JINA_BASE_URL     = "https://r.jina.ai";
const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape";

// ── Helpers ───────────────────────────────────────────────────────────────────

// HTTP status codes that indicate the server is actively blocking us.
// Receiving one of these means retrying the same request won't help — we
// should escalate to the next tier instead.
function isBlockingStatus(status: number): boolean {
  return (
    status === 401 || // Unauthorised
    status === 403 || // Forbidden (bot wall)
    status === 407 || // Proxy auth required
    status === 429 || // Rate limited
    status >= 500     // Server-side error
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Tier 1: native fetch + Readability ───────────────────────────────────────

async function fetchDirect(
  url: string,
): Promise<{ title?: string; text: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (isBlockingStatus(res.status)) {
      throw new Error(`HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    const finalUrl = res.url || url;
    const body = await res.text();

    // Non-HTML responses (JSON, plain text, XML) are returned as-is after
    // whitespace normalisation — no point running Readability on them.
    if (!contentType.includes("text/html")) {
      return { text: cleanText(body), finalUrl };
    }

    const { title, text } = extractReadableContent(body, finalUrl);

    if (!text.trim()) {
      throw new Error("no content extracted — page may be JS-rendered");
    }

    return { title, text, finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

// ── Tier 2: Jina Reader ───────────────────────────────────────────────────────

async function fetchViaJina(
  url: string,
): Promise<{ text: string; finalUrl: string }> {
  // Jina's Reader API is dead simple: prefix any URL with r.jina.ai/
  const jinaUrl = `${JINA_BASE_URL}/${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

  const headers: Record<string, string> = {
    Accept: "text/plain, text/markdown",
  };

  // Optional API key for higher rate limits (free without key, just throttled).
  const apiKey = process.env.JINA_API_KEY?.trim();
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(jinaUrl, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: cleanText(await res.text()), finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

// ── Tier 3: Firecrawl ─────────────────────────────────────────────────────────

async function fetchViaFirecrawl(
  url: string,
  apiKey: string,
): Promise<{ title?: string; text: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT_MS);

  try {
    const res = await fetch(FIRECRAWL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as {
      success?: boolean;
      data?: {
        markdown?: string;
        metadata?: { title?: string; sourceURL?: string };
      };
    };

    if (!data.success || !data.data?.markdown) {
      throw new Error("empty response");
    }

    return {
      title: data.data.metadata?.title,
      text: cleanText(data.data.markdown),
      finalUrl: data.data.metadata?.sourceURL ?? url,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Output formatting ─────────────────────────────────────────────────────────

function formatResult(params: {
  url: string;
  title?: string;
  extractor: string;
  text: string;
  omitted: number;
}): string {
  const lines: string[] = [
    `URL: ${params.url}`,
    ...(params.title ? [`Title: ${params.title}`] : []),
    `Extractor: ${params.extractor}`,
    "",
    params.text,
  ];

  if (params.omitted > 0) {
    lines.push(`\n[${params.omitted} characters omitted — content was truncated at ${MAX_OUTPUT_CHARS} chars]`);
  }

  return lines.join("\n");
}

// ── Tool export ───────────────────────────────────────────────────────────────

export const webFetchTool: ToolDefinition = {
  name: "web_fetch",

  description:
    "Fetch a public web page and return its main content as clean, readable text. " +
    "Automatically strips navigation, ads, headers, and footers — the model receives " +
    "only the article or content body. " +
    "Falls back to Jina Reader (and optionally Firecrawl) if the direct request is blocked " +
    "or if the page requires JavaScript to render.",

  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The full HTTP or HTTPS URL to fetch.",
      },
    },
    required: ["url"],
  },

  async execute(args): Promise<string> {
    const rawUrl = String(args["url"] ?? "").trim();
    process.stderr.write(`\x1b[33m[web_fetch]\x1b[0m ${rawUrl}\n`);

    // SSRF guard — validates protocol, blocks private IPs and internal hosts.
    try {
      await validatePublicUrl(rawUrl, "fetch");
    } catch (err) {
      return `Error: ${errMessage(err)}`;
    }

    const errors: string[] = [];

    // Tier 1: native fetch + Readability
    try {
      const { title, text, finalUrl } = await fetchDirect(rawUrl);
      const { text: out, omitted } = truncateOutput(text, MAX_OUTPUT_CHARS);
      return formatResult({ url: finalUrl, title, extractor: "direct", text: out, omitted });
    } catch (err) {
      errors.push(`direct: ${errMessage(err)}`);
    }

    // Tier 2: Jina Reader
    try {
      const { text, finalUrl } = await fetchViaJina(rawUrl);
      const { text: out, omitted } = truncateOutput(text, MAX_OUTPUT_CHARS);
      return formatResult({ url: finalUrl, extractor: "jina", text: out, omitted });
    } catch (err) {
      errors.push(`jina: ${errMessage(err)}`);
    }

    // Tier 3: Firecrawl (only if API key is configured)
    const firecrawlKey = process.env.FIRECRAWL_API_KEY?.trim();
    if (firecrawlKey) {
      try {
        const { title, text, finalUrl } = await fetchViaFirecrawl(rawUrl, firecrawlKey);
        const { text: out, omitted } = truncateOutput(text, MAX_OUTPUT_CHARS);
        return formatResult({ url: finalUrl, title, extractor: "firecrawl", text: out, omitted });
      } catch (err) {
        errors.push(`firecrawl: ${errMessage(err)}`);
      }
    }

    // All tiers failed — tell the model what happened so it can decide.
    return [
      `Failed to fetch: ${rawUrl}`,
      `Attempts: ${errors.join(" | ")}`,
      "You may try a different URL, ask the user to check their network, or proceed without this content.",
    ].join("\n");
  },
};
