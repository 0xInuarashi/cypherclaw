// providers/types.ts
// -------------------
// Shared types used by every provider implementation.
//
// Message roles:
//   "system"    — Instructions given to the model before the conversation
//                 starts. Sets the persona, constraints, and goals of the agent.
//   "user"      — A message from the human.
//   "assistant" — A previous reply from the model. Kept in history so the
//                 model has context about what it already said.
//
// Tool calling:
//   Providers optionally accept a list of ToolDefinitions. When tools are
//   supplied, the model may respond with tool call requests instead of text.
//   The provider runs the agentic loop internally (execute tool → feed result
//   back → call again) and always returns a final plain-text string to the
//   caller. The agent and channels never need to know the loop happened.

import type { ToolDefinition } from "../tools/types/types.js";

// Re-export so callers can import both from one place if they want.
export type { ToolDefinition };

// A single message in the conversation visible to our agent and providers.
// Tool-call internals (result messages, etc.) are handled inside each provider
// using their native API types — they never surface here.
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

// Token consumption reported by the LLM API for a single chat() call.
// Covers both OpenAI-style (prompt/completion) and Anthropic-style
// (input/output + cache) APIs — mapped to a unified shape.
//   input        — tokens in the prompt sent to the model
//   output       — tokens in the model's reply
//   cacheRead    — prompt tokens served from the provider's prompt cache
//   cacheCreation — prompt tokens written into the cache this call
export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export function zeroUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheCreation: a.cacheCreation + b.cacheCreation,
  };
}

// The interface every provider must satisfy.
//   messages — full conversation history including the system prompt.
//   tools    — optional list of tools the model is allowed to call.
// Returns the model's final text reply and the total token usage across
// all tool-call rounds in this chat() invocation.
export type Provider = {
  chat(messages: Message[], tools?: ToolDefinition[], signal?: AbortSignal): Promise<{ text: string; usage: TokenUsage }>;
};
