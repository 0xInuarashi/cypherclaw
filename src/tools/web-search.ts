// tools/web-search.ts
// -------------------
// Searches the web and returns a ranked list of results (title, URL, snippet,
// date) as clean text for the model to reason over.
//
// Design intent:
//   This tool finds. web_fetch reads. The model uses both together: search for
//   candidates, then fetch the ones that look relevant.
//
// Six-tier pipeline — each tier tried in order, falling through on failure or
// empty results. Tiers that require an API key are skipped if the key is absent.
//
//   Tier 1 — DuckDuckGo Instant Answer API  (free, no key, official)
//     Returns structured "instant answers" — Wikipedia abstracts, definitions,
//     calculator results, related topics. Not real web search. Falls through
//     fast if no meaningful results are found.
//
//   Tier 2 — Marginalia Search  (free, no key required, independent index)
//     Open-source search engine with a JSON API. Uses key "public" by default
//     (shared rate limit). Set MARGINALIA_API_KEY to a dedicated key obtained
//     by emailing contact@marginalia-search.com (free, non-commercial).
//     Focuses on text-heavy, non-commercial web — great for research and tech,
//     weaker on breaking news.
//
//   Tier 3 — Jina Search  (s.jina.ai, requires JINA_API_KEY)
//     Returns clean markdown search results. Set JINA_API_KEY for access;
//     skipped silently if absent (keyless tier now returns 401).
//
//   Tier 4 — Brave Search  (requires BRAVE_API_KEY, skipped if absent)
//     High-quality independent index. Up to 20 results per request.
//
//   Tier 5 — Tavily  (requires TAVILY_API_KEY, skipped if absent)
//     Purpose-built for LLM agents. Returns LLM-optimised snippets.
//
//   Tier 6 — Exa  (requires EXA_API_KEY, skipped if absent)
//     Neural/semantic search. Great for research and nuanced queries.

import type { ToolDefinition } from "./types.js";
import { cleanText, truncateOutput } from "./utils/browser-utils.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DDG_INSTANT_URL      = "https://api.duckduckgo.com/";
const MARGINALIA_SEARCH_URL = "https://api2.marginalia-search.com/search";
const JINA_SEARCH_URL      = "https://s.jina.ai/";
const BRAVE_SEARCH_URL     = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_URL           = "https://api.tavily.com/search";
const EXA_URL              = "https://api.exa.ai/search";

// Per-tier timeouts.
const DDG_TIMEOUT_MS        = 10_000;
const MARGINALIA_TIMEOUT_MS = 10_000;
const JINA_TIMEOUT_MS       = 15_000;
const BRAVE_TIMEOUT_MS      = 10_000;
const TAVILY_TIMEOUT_MS     = 15_000;
const EXA_TIMEOUT_MS        = 15_000;

// Maximum results requested per tier (where configurable).
const MAX_RESULTS = 20;

// Output cap — search results are concise so this is generous.
const MAX_OUTPUT_CHARS = 20_000;

// ── Types ─────────────────────────────────────────────────────────────────────

// Normalised result shape shared across all tiers.
type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  date?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Aborts a fetch after `ms` milliseconds.
function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

// Sorts results by date descending (most recent first).
// Results without a date are kept but pushed to the end.
function sortByDate(results: SearchResult[]): SearchResult[] {
  return results.slice().sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}



// ── Tier 1: DuckDuckGo Instant Answer API ─────────────────────────────────────

// The Instant Answer API is DDG's official offering. It returns things like
// Wikipedia abstracts and related topic links — not general web results. It's
// worth trying first because it's fast, free, and occasionally perfect (e.g.
// definitional queries). Falls through quickly when it has nothing useful.
async function searchDdgInstant(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    no_redirect: "1",
    skip_disambig: "1",
  });

  const res = await fetch(`${DDG_INSTANT_URL}?${params}`, {
    headers: { Accept: "application/json" },
    signal: withTimeout(DDG_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    Heading?: string;
    Results?: Array<{ Text: string; FirstURL: string }>;
    RelatedTopics?: Array<
      | { Text: string; FirstURL: string }
      | { Name: string; Topics: Array<{ Text: string; FirstURL: string }> }
    >;
  };

  const results: SearchResult[] = [];

  // Top abstract (e.g. Wikipedia article summary).
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading ?? data.AbstractSource ?? "Abstract",
      url: data.AbstractURL,
      snippet: cleanText(data.AbstractText),
    });
  }

  // Inline results (rare but precise).
  for (const r of data.Results ?? []) {
    if (r.FirstURL && r.Text) {
      results.push({ title: r.Text.slice(0, 80), url: r.FirstURL, snippet: cleanText(r.Text) });
    }
  }

  // Related topics — may be flat items or nested topic groups.
  for (const topic of data.RelatedTopics ?? []) {
    if ("Topics" in topic) {
      // Topic group — flatten the children.
      for (const sub of topic.Topics) {
        if (sub.FirstURL && sub.Text) {
          results.push({ title: sub.Text.slice(0, 80), url: sub.FirstURL, snippet: cleanText(sub.Text) });
        }
      }
    } else if (topic.FirstURL && topic.Text) {
      results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, snippet: cleanText(topic.Text) });
    }
  }

  return results;
}

// ── Tier 2: Marginalia Search ─────────────────────────────────────────────────

// Marginalia is an independent open-source search engine with a clean JSON API.
// The key "public" is available to everyone with no signup — it has a shared
// rate limit (503 when exhausted). Set MARGINALIA_API_KEY to a dedicated key
// obtained free by emailing contact@marginalia-search.com.
//
// Marginalia focuses on text-heavy, non-commercial, indie web content.
// Excellent for research and technical queries; weaker on breaking news.
async function searchMarginalia(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.MARGINALIA_API_KEY?.trim() ?? "public";
  const params = new URLSearchParams({ query, count: String(MAX_RESULTS) });

  const res = await fetch(`${MARGINALIA_SEARCH_URL}?${params}`, {
    headers: { "API-Key": apiKey },
    signal: withTimeout(MARGINALIA_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    results?: Array<{ url?: string; title?: string; description?: string }>;
  };

  return (data.results ?? [])
    .filter((r) => r.url && (r.title || r.description))
    .map((r) => ({
      title: cleanText(r.title ?? r.url ?? ""),
      url: r.url ?? "",
      snippet: cleanText(r.description ?? ""),
    }));
}

// ── Tier 3: Jina Search ───────────────────────────────────────────────────────

// Jina's Reader has a companion search endpoint: GET s.jina.ai/{query}
// Returns clean markdown — no HTML parsing needed. Set JINA_API_KEY for a
// higher rate limit; the free (keyless) tier works but may be throttled.
async function searchJina(query: string): Promise<SearchResult[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Respond-With": "no-content", // return result metadata, not full page content
  };

  const apiKey = process.env.JINA_API_KEY?.trim();
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${JINA_SEARCH_URL}${encodeURIComponent(query)}`, {
    headers,
    signal: withTimeout(JINA_TIMEOUT_MS),
  });

  // Jina's search endpoint requires a key — silently skip if keyless and blocked.
  if (res.status === 401 && !apiKey) return [];

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    data?: Array<{
      title?: string;
      url?: string;
      description?: string;
      date?: string;
    }>;
  };

  return (data.data ?? [])
    .filter((r) => r.url && (r.title || r.description))
    .map((r) => ({
      title: cleanText(r.title ?? r.url ?? ""),
      url: r.url ?? "",
      snippet: cleanText(r.description ?? ""),
      date: r.date,
    }));
}

// ── Tier 4: Brave Search ──────────────────────────────────────────────────────

async function searchBrave(query: string, apiKey: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(MAX_RESULTS),
  });

  const res = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: withTimeout(BRAVE_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        age?: string; // e.g. "2 days ago" or ISO date
      }>;
    };
  };

  return (data.web?.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: cleanText(r.title ?? ""),
      url: r.url ?? "",
      snippet: cleanText(r.description ?? ""),
      date: r.age,
    }));
}

// ── Tier 5: Tavily ────────────────────────────────────────────────────────────

async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      max_results: MAX_RESULTS,
      search_depth: "advanced",
      include_answer: false,
    }),
    signal: withTimeout(TAVILY_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      published_date?: string;
    }>;
  };

  return (data.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: cleanText(r.title ?? ""),
      url: r.url ?? "",
      snippet: cleanText(r.content ?? ""),
      date: r.published_date,
    }));
}

// ── Tier 6: Exa ───────────────────────────────────────────────────────────────

async function searchExa(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch(EXA_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      numResults: MAX_RESULTS,
      type: "auto", // let Exa decide between keyword and neural search
      contents: { text: { maxCharacters: 500 } }, // snippet-length content
    }),
    signal: withTimeout(EXA_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      text?: string;
      publishedDate?: string;
    }>;
  };

  return (data.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: cleanText(r.title ?? ""),
      url: r.url ?? "",
      snippet: cleanText(r.text ?? ""),
      date: r.publishedDate,
    }));
}

// ── Output formatting ─────────────────────────────────────────────────────────

function formatResults(params: {
  query: string;
  source: string;
  results: SearchResult[];
}): string {
  const lines: string[] = [
    `Query: ${params.query}`,
    `Source: ${params.source}`,
    `Results: ${params.results.length}`,
    "",
  ];

  for (let i = 0; i < params.results.length; i++) {
    const r = params.results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.date) lines.push(`   ${r.date}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push("");
  }

  const raw = lines.join("\n").trimEnd();
  const { text, omitted } = truncateOutput(raw, MAX_OUTPUT_CHARS);
  return omitted > 0
    ? `${text}\n\n[${omitted} characters omitted]`
    : text;
}

// ── Tool export ───────────────────────────────────────────────────────────────

export const webSearchTool: ToolDefinition = {
  name: "web_search",

  description:
    "Search the web for a query and return a list of results with titles, URLs, " +
    "snippets, and dates. Use this to find relevant pages, then use web_fetch " +
    "to read the full content of any result that looks useful.",

  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query.",
      },
    },
    required: ["query"],
  },

  async execute(args): Promise<string> {
    const query = String(args["query"] ?? "").trim();
    if (!query) return "Error: query is required.";

    process.stderr.write(`\x1b[33m[web_search]\x1b[0m ${query}\n`);

    const errors: string[] = [];

    // Tier 1: DDG Instant Answer
    try {
      const results = await searchDdgInstant(query);
      if (results.length > 0) {
        return formatResults({ query, source: "ddg-instant", results: sortByDate(results) });
      }
      errors.push("ddg-instant: no results");
    } catch (err) {
      errors.push(`ddg-instant: ${errMessage(err)}`);
    }

    // Tier 2: Marginalia Search
    try {
      const results = await searchMarginalia(query);
      if (results.length > 0) {
        return formatResults({ query, source: "marginalia", results: sortByDate(results) });
      }
      errors.push("marginalia: no results");
    } catch (err) {
      errors.push(`marginalia: ${errMessage(err)}`);
    }

    // Tier 3: Jina Search (always tried, optional key)
    try {
      const results = await searchJina(query);
      if (results.length > 0) {
        return formatResults({ query, source: "jina", results: sortByDate(results) });
      }
      errors.push("jina: no results");
    } catch (err) {
      errors.push(`jina: ${errMessage(err)}`);
    }

    // Tier 4: Brave (key required)
    const braveKey = process.env.BRAVE_API_KEY?.trim();
    if (braveKey) {
      try {
        const results = await searchBrave(query, braveKey);
        if (results.length > 0) {
          return formatResults({ query, source: "brave", results: sortByDate(results) });
        }
        errors.push("brave: no results");
      } catch (err) {
        errors.push(`brave: ${errMessage(err)}`);
      }
    }

    // Tier 5: Tavily (key required)
    const tavilyKey = process.env.TAVILY_API_KEY?.trim();
    if (tavilyKey) {
      try {
        const results = await searchTavily(query, tavilyKey);
        if (results.length > 0) {
          return formatResults({ query, source: "tavily", results: sortByDate(results) });
        }
        errors.push("tavily: no results");
      } catch (err) {
        errors.push(`tavily: ${errMessage(err)}`);
      }
    }

    // Tier 6: Exa (key required)
    const exaKey = process.env.EXA_API_KEY?.trim();
    if (exaKey) {
      try {
        const results = await searchExa(query, exaKey);
        if (results.length > 0) {
          return formatResults({ query, source: "exa", results: sortByDate(results) });
        }
        errors.push("exa: no results");
      } catch (err) {
        errors.push(`exa: ${errMessage(err)}`);
      }
    }

    return [
      `Failed to search for: ${query}`,
      `Attempts: ${errors.join(" | ")}`,
      "You may try rephrasing the query or ask the user to configure a search API key.",
    ].join("\n");
  },
};
