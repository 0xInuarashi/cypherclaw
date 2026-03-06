// tools/utils/browser-utils.ts
// -----------------------------
// Shared utilities for browser-based tools (web_fetch, web_action, etc.).
//
// Extracted here to avoid code duplication between the two tool files and to
// give future tools a single place to import from.
//
// Contents:
//   - SSRF / private-IP detection (isPrivateIPv4, isPrivateIPv6, isPrivateIp)
//   - URL validation          (BLOCKED_HOSTNAMES, validatePublicUrl)
//   - Text normalisation      (cleanText)
//   - Output capping          (truncateOutput)

import dns from "node:dns/promises";
import net from "node:net";

// ── SSRF blocklist ────────────────────────────────────────────────────────────

// Hostnames that must never be accessed regardless of what the model requests.
// These could leak internal metadata (GCP/AWS metadata endpoints) or expose
// services that are only reachable from localhost.
export const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "::",
  "::1",
  "host.docker.internal",
  "metadata.google.internal",
]);

// ── SSRF / private-IP detection ───────────────────────────────────────────────
//
// These functions guard against Server-Side Request Forgery (SSRF): a class of
// attack where an attacker tricks the server into making requests to internal
// network resources. We check both the hostname string *and* the resolved IP
// addresses to cover DNS rebinding attacks (where a public hostname resolves to
// a private IP at request time).

export function isPrivateIPv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;       // 0.x, 10.x, loopback
  if (a === 169 && b === 254) return true;                  // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;        // 172.16–31.x
  if (a === 192 && b === 168) return true;                  // 192.168.x
  if (a === 100 && b >= 64 && b <= 127) return true;       // shared address space (RFC 6598)
  if (a === 198 && (b === 18 || b === 19)) return true;    // benchmarking (RFC 2544)

  return false;
}

export function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized === "::" || normalized === "::1") {
    return true;                                            // unspecified / loopback
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;                                            // unique local (RFC 4193)
  }

  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;                                            // link-local (fe80::/10)
  }

  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 address — check the embedded IPv4 part.
    const mapped = normalized.slice("::ffff:".length);
    return net.isIPv4(mapped) ? isPrivateIPv4(mapped) : false;
  }

  return false;
}

export function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) return isPrivateIPv4(address);
  if (net.isIPv6(address)) return isPrivateIPv6(address);
  return false;
}

// ── URL validation ────────────────────────────────────────────────────────────

// Parses, validates, and DNS-resolves a URL before we hand it to any browser.
// Throws a descriptive error for:
//   - Non-HTTP(S) protocols
//   - Known-blocked hostnames (localhost, metadata endpoints, etc.)
//   - Hostnames that are or resolve to private/loopback IP addresses
//
// The optional `verb` parameter is used in error messages so callers can
// surface context-specific wording (e.g. "fetch" for web_fetch, "open" for
// web_action). Defaults to "access".
export async function validatePublicUrl(input: string, verb = "access"): Promise<URL> {
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
    throw new Error(`Refusing to ${verb} a local or internal host: ${hostname}`);
  }

  // If the hostname is already an IP address, check it directly.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Refusing to ${verb} a private or loopback address: ${hostname}`);
    }
    return url;
  }

  // Resolve the hostname so we can inspect its IP addresses.
  // `all: true` returns every address, `verbatim: true` preserves the
  // order returned by the OS resolver (important for round-robin DNS).
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err: unknown) {
    const error = err as { message?: string };
    throw new Error(`Could not resolve hostname ${hostname}: ${error.message ?? String(err)}`);
  }

  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error(`Refusing to ${verb} ${hostname} because it resolves to a private or loopback address.`);
  }

  return url;
}

// ── Text helpers ──────────────────────────────────────────────────────────────

// Normalises whitespace in extracted page text so the model receives clean,
// consistent input instead of raw browser whitespace artefacts.
export function cleanText(input: string): string {
  return input
    .replace(/\r/g, "")               // normalise line endings
    .replace(/\u00a0/g, " ")          // replace non-breaking spaces
    .replace(/[ \t]+\n/g, "\n")       // strip trailing whitespace from lines
    .replace(/\n[ \t]+/g, "\n")       // strip leading whitespace from lines
    .replace(/[ \t]{2,}/g, " ")       // collapse multiple spaces/tabs
    .replace(/\n{3,}/g, "\n\n")       // collapse more than two blank lines
    .trim();
}

// Caps output at `limit` characters and returns how many were omitted so the
// caller can append an informational note to the model output.
export function truncateOutput(text: string, limit: number): { text: string; omitted: number } {
  if (text.length <= limit) {
    return { text, omitted: 0 };
  }

  return {
    text: text.slice(0, limit),
    omitted: text.length - limit,
  };
}
