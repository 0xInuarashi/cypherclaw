// src/tools/temp-email.test.ts
// ----------------------------
// Tests for the temp_email tool.
//
// Test strategy:
//   Unit tests   — pure logic: bad inputs, error messages, token validation.
//                  These are fast and never hit the network.
//   Integration  — real Mail.tm / Mail.gw API calls (free, no key required).
//                  These verify the full create → list flow actually works.
//                  Skipped automatically if NO_NETWORK=1 is set.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { tempEmailTool } from "../temp-email.js";

// Convenience wrapper so tests read cleanly.
async function run(args: Record<string, unknown>): Promise<string> {
  return tempEmailTool.execute(args) as Promise<string>;
}

const skipNetwork = process.env["NO_NETWORK"] === "1";

// ── Unit tests — no network required ─────────────────────────────────────────

describe("temp_email — unit", () => {
  it("returns error for unknown action", async () => {
    const result = await run({ action: "nope" });
    assert.match(result, /unknown action/i);
  });

  it("requires token for action 'list'", async () => {
    const result = await run({ action: "list" });
    assert.match(result, /token.*required/i);
  });

  it("requires token for action 'read'", async () => {
    const result = await run({ action: "read" });
    assert.match(result, /token.*required/i);
  });

  it("requires message_id for action 'read' when token is present", async () => {
    // A syntactically valid token — provider is real but JWT is fake.
    // This will fail at the API call, but we want to hit the message_id guard first.
    const result = await run({ action: "read", token: "mailtm::fake.jwt.value" });
    assert.match(result, /message_id.*required/i);
  });

  it("rejects a token with no provider prefix", async () => {
    const result = await run({ action: "list", token: "thisisnotavalidtoken" });
    assert.match(result, /invalid token/i);
  });

  it("rejects a token with an unknown provider prefix", async () => {
    const result = await run({ action: "list", token: "yahoo::somejwt" });
    assert.match(result, /unknown provider/i);
  });
});

// ── Integration tests — real API calls ────────────────────────────────────────

describe("temp_email — integration", { skip: skipNetwork }, () => {
  let token = "";
  let address = "";

  // Create an inbox once; subsequent tests use the returned token.
  before(async () => {
    const result = await run({ action: "create" });
    // Extract address and token from the formatted output.
    const addrMatch = result.match(/Address\s*:\s*(\S+@\S+)/);
    const tokenMatch = result.match(/Token\s*:\s*(\S+)/);
    assert.ok(addrMatch, `create did not return an address.\nFull output:\n${result}`);
    assert.ok(tokenMatch, `create did not return a token.\nFull output:\n${result}`);
    address = addrMatch[1];
    token = tokenMatch[1];
  });

  it("create returns a valid email address", () => {
    assert.match(address, /@/, "address should contain @");
    assert.match(address, /^[^@]+@[^@]+\.[^@]+$/, "address should be a full email");
  });

  it("create returns a token with a known provider prefix", () => {
    assert.ok(
      token.startsWith("mailtm::") || token.startsWith("mailgw::"),
      `token should start with mailtm:: or mailgw::, got: ${token.slice(0, 20)}`,
    );
  });

  it("list on a fresh inbox returns empty or a message list", async () => {
    const result = await run({ action: "list", token });
    // A fresh inbox is almost certainly empty — either response is valid.
    const isEmpty = /inbox is empty/i.test(result);
    const hasList = /message\(s\) in inbox/i.test(result);
    assert.ok(isEmpty || hasList, `unexpected list response:\n${result}`);
  });

  it("list with a bad JWT returns an error (not a crash)", async () => {
    // Keep the provider prefix valid but corrupt the JWT — should get a
    // meaningful error string back, not an unhandled exception.
    const badToken = token.replace(/::.*/, "::corrupted.jwt.payload");
    const result = await run({ action: "list", token: badToken });
    assert.match(result, /error/i);
  });
});
