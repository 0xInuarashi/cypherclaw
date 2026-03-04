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

import type { ToolDefinition } from "../tools/types.js";

// Re-export so callers can import both from one place if they want.
export type { ToolDefinition };

// A single message in the conversation visible to our agent and providers.
// Tool-call internals (result messages, etc.) are handled inside each provider
// using their native API types — they never surface here.
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

// The interface every provider must satisfy.
//   messages — full conversation history including the system prompt.
//   tools    — optional list of tools the model is allowed to call.
// Returns the model's final text reply after any tool calls are resolved.
export type Provider = {
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<string>;
};
