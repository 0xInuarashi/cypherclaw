// tools/utils/readability.ts
// --------------------------
// Extracts clean, readable text from raw HTML using Mozilla Readability —
// the same algorithm that powers Firefox Reader Mode.
//
// Why Readability over plain tag-stripping?
//   A raw HTML page is mostly boilerplate: nav bars, cookie banners, sidebars,
//   footers, ad containers. Readability identifies the main article/content
//   area and discards everything else, yielding far higher signal for the model.
//
// Fallback behaviour:
//   If Readability can't identify a main content area (e.g. on a homepage or
//   purely navigational page), we fall back to naive tag-stripping so we still
//   return something useful rather than nothing.

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { cleanText } from "./browser-utils.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReadableContent = {
  title?: string;
  text: string;
};

// ── Fallback: naive tag stripper ──────────────────────────────────────────────

// Last-resort extraction when Readability finds no main content.
// Strips scripts, styles, and all HTML tags, then decodes common entities.
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

// ── Main export ───────────────────────────────────────────────────────────────

// Parses raw HTML and returns the main content as clean plain text.
// The `url` is passed to Readability so it can resolve relative links correctly.
// Never throws — falls back to tag-stripping on any error.
export function extractReadableContent(html: string, url: string): ReadableContent {
  try {
    const { document } = parseHTML(html);

    // Best-effort: set baseURI so Readability resolves relative links.
    try {
      (document as unknown as { baseURI: string }).baseURI = url;
    } catch {
      // Non-critical — skip silently.
    }

    const reader = new Readability(document as unknown as Document, {
      charThreshold: 0, // don't discard short articles
    });
    const parsed = reader.parse();

    if (parsed?.textContent?.trim()) {
      return {
        title: parsed.title?.trim() || undefined,
        text: cleanText(parsed.textContent),
      };
    }
  } catch {
    // Readability can throw on pathological HTML — fall through.
  }

  // Fallback: strip tags and return whatever text remains.
  return { text: cleanText(stripHtml(html)) };
}
