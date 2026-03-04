// providers/openai.ts
// --------------------
// Provider implementation for the OpenAI Chat Completions API.
//
// API reference: https://platform.openai.com/docs/api-reference/chat
//
// We use Node's built-in `fetch` (available since Node 18) rather than the
// openai npm package. This keeps our dependency tree minimal and makes the HTTP
// contract explicit — you can see exactly what's being sent and received.
//
// Request shape (POST https://api.openai.com/v1/chat/completions):
//   {
//     model: "gpt-4o-mini",
//     messages: [{ role: "user" | "assistant" | "system", content: "..." }]
//   }
//
// Response shape (simplified):
//   {
//     choices: [{ message: { content: "..." } }]
//   }

import type { Message, Provider } from "./types.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Minimal type covering only the fields we read from the response.
type OpenAIResponse = {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
};

export function createOpenAIProvider(opts: { apiKey: string; model: string }): Provider {
  return {
    async chat(messages: Message[]): Promise<string> {
      const res = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The API key is sent as a Bearer token in the Authorization header.
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
        }),
      });

      if (!res.ok) {
        // Include the response body in the error so the caller knows whether
        // it's an auth problem, a bad model name, a rate limit, etc.
        const body = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as OpenAIResponse;

      // `choices[0]` is the primary completion. The API can return multiple
      // choices if n > 1, but we always request the default of n=1.
      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error("OpenAI returned an empty response");
      }

      return content;
    },
  };
}
