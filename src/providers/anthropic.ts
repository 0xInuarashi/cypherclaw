// providers/anthropic.ts
// -----------------------
// Provider implementation for the Anthropic Messages API.
//
// API reference: https://docs.anthropic.com/en/api/messages
//
// Anthropic's API is intentionally different from OpenAI's in one key way:
// the system prompt is a top-level field on the request body, NOT a message
// with role "system". We handle this by extracting any system message from the
// history before sending, and passing it separately.
//
// Request shape (POST https://api.anthropic.com/v1/messages):
//   {
//     model: "claude-3-5-haiku-20241022",
//     max_tokens: 8096,
//     system: "...",           ← extracted from messages, not part of the array
//     messages: [              ← only "user" and "assistant" roles allowed here
//       { role: "user",      content: "..." },
//       { role: "assistant", content: "..." }
//     ]
//   }
//
// Response shape (simplified):
//   {
//     content: [{ type: "text", text: "..." }]
//   }

import type { Message, Provider } from "./types.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// The API version header Anthropic requires on every request.
const ANTHROPIC_VERSION = "2023-06-01";

// Anthropic requires a max_tokens value. We use a large default that covers
// most responses without artificially truncating long answers.
const DEFAULT_MAX_TOKENS = 8192;

// Minimal type covering only the fields we read from the response.
type AnthropicResponse = {
  content: Array<{
    type: string;
    text: string;
  }>;
};

export function createAnthropicProvider(opts: { apiKey: string; model: string }): Provider {
  return {
    async chat(messages: Message[]): Promise<string> {
      // Anthropic does not accept "system" as a message role — it must be sent
      // as a separate top-level field. Extract it if present.
      const systemMessage = messages.find((m) => m.role === "system");
      const conversationMessages = messages.filter((m) => m.role !== "system");

      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: conversationMessages,
      };

      if (systemMessage) {
        body.system = systemMessage.content;
      }

      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Anthropic uses a custom header for the API key, not Authorization.
          "x-api-key": opts.apiKey,
          // Anthropic requires this header to select the API version.
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as AnthropicResponse;

      // Anthropic's response content is an array of blocks (text, tool_use,
      // etc.). We find the first text block and return its text.
      const textBlock = data.content.find((block) => block.type === "text");
      if (!textBlock?.text) {
        throw new Error("Anthropic returned an empty response");
      }

      return textBlock.text;
    },
  };
}
