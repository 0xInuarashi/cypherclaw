// src/tools/test/tts.test.ts
// --------------------------
// Tests for the tts tool.
//
// Test strategy:
//   Unit tests   — pure logic: token format, XML escaping, no network required.
//   Integration  — real WebSocket call to speech.platform.bing.com.
//                  Produces an actual audio file on disk.
//                  Skipped automatically if NO_NETWORK=1 is set.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { generateSecMsGecToken, escapeXml, ttsTool } from "../tts.js";

async function run(args: Record<string, unknown>): Promise<string> {
  return ttsTool.execute(args) as Promise<string>;
}

const skipNetwork = process.env["NO_NETWORK"] === "1";

// ── Unit tests — no network required ─────────────────────────────────────────

describe("tts — generateSecMsGecToken", () => {
  it("returns a 64-character uppercase hex string", () => {
    const token = generateSecMsGecToken();
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9A-F]{64}$/);
  });

  it("returns the same value when called twice within the same 5-minute window", () => {
    const a = generateSecMsGecToken();
    const b = generateSecMsGecToken();
    assert.equal(a, b);
  });
});

describe("tts — escapeXml", () => {
  it("escapes <", () => assert.equal(escapeXml("<"), "&lt;"));
  it("escapes >", () => assert.equal(escapeXml(">"), "&gt;"));
  it("escapes &", () => assert.equal(escapeXml("&"), "&amp;"));
  it('escapes "', () => assert.equal(escapeXml('"'), "&quot;"));
  it("escapes '", () => assert.equal(escapeXml("'"), "&apos;"));

  it("escapes all special chars in a mixed string", () => {
    assert.equal(
      escapeXml(`<b class="x">it's a & test</b>`),
      `&lt;b class=&quot;x&quot;&gt;it&apos;s a &amp; test&lt;/b&gt;`
    );
  });

  it("leaves plain text untouched", () => {
    const plain = "Hello world 123";
    assert.equal(escapeXml(plain), plain);
  });
});

// ── Integration tests — real WebSocket call ───────────────────────────────────

describe("tts — integration", { skip: skipNetwork }, () => {
  const filename = `tts-test-${Date.now()}.mp3`;
  let outputPath = "";

  after(() => {
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  it("generates an audio file for a short phrase", async () => {
    const result = await run({ text: "Hello world", filename });
    assert.match(result, /Audio saved to:/);
    outputPath = result.replace("Audio saved to: ", "").trim();
    assert.ok(fs.existsSync(outputPath), `file not found: ${outputPath}`);
    const size = fs.statSync(outputPath).size;
    assert.ok(size > 1000, `file too small (${size} bytes) — likely empty or truncated`);
  });

  it("returns a TTS failed message on network error (bad timeout)", async () => {
    const result = await run({ text: "test", filename: `tts-timeout-${Date.now()}.mp3`, timeout_ms: 1 });
    assert.match(result, /Audio saved to:|TTS failed:/);
  });
});
