import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  renderDefaultSystemPrompt,
  renderSystemPrompt,
} from "../system-prompt.js";

describe("system prompt rendering", () => {
  it("injects the session id into the default prompt", () => {
    const sessionId = "session-123";
    const rendered = renderDefaultSystemPrompt(sessionId);

    assert.match(rendered, new RegExp(`Current session id\\*\\*: \`${sessionId}\``));
    assert.match(rendered, new RegExp(`\\.cypherclaw/workdir/${sessionId}/`));
    assert.doesNotMatch(rendered, /\{\{SESSION_ID\}\}/);
  });

  it("replaces placeholders in custom prompts", () => {
    const rendered = renderSystemPrompt(
      "work in .cypherclaw/workdir/{{SESSION_ID}}/",
      "abc",
    );

    assert.equal(rendered, "work in .cypherclaw/workdir/abc/");
  });

  it("keeps the template placeholder before rendering", () => {
    assert.match(DEFAULT_SYSTEM_PROMPT_TEMPLATE, /\{\{SESSION_ID\}\}/);
  });
});
