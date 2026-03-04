// agent/index.ts
// ---------------
// The agent is the "brain" of CypherClaw — it receives a user message,
// maintains the conversation history, calls the LLM provider (with tools if
// provided), and returns the model's final reply.
//
// Architecture note:
//   The agent is expressed as a plain async function type (`AgentFn`) rather
//   than a class. This keeps things composable: any function that takes a
//   string and returns a Promise<string> qualifies as an agent. The channel
//   (e.g. terminal) calls the agent without caring about its internals, and the
//   agent doesn't know or care which channel it's running inside.
//
// Conversation history:
//   LLMs are stateless — every API call is independent. We simulate memory by
//   keeping a local array of all messages exchanged so far. On each call we
//   send the full history so the model has context about prior turns.
//
// Tool calling:
//   If tools are passed in AgentOptions, they're forwarded to the provider on
//   every call. The provider runs the full agentic loop (call → execute tools
//   → call again) and returns the final text reply. The agent itself doesn't
//   need to know the loop happened — it just gets a string back.
//
// AgentOptions:
//   systemPrompt — instruction string given to the model before any user
//                  messages. Sets persona, constraints, and goals.
//   provider     — the LLM backend (openai / anthropic / openrouter).
//                  If omitted, the agent falls back to an echo stub.
//   tools        — list of tools the model is allowed to call.

import type { Provider } from "../providers/types.js";
import type { Message } from "../providers/types.js";
import type { ToolDefinition } from "../tools/types.js";

// The function signature every agent must satisfy.
export type AgentFn = (message: string) => Promise<string>;

// Configuration passed to createAgent at construction time.
export type AgentOptions = {
  systemPrompt?: string;
  provider?: Provider;
  // Tools forwarded to the provider so the model can call them.
  // If omitted (or empty), the model operates in plain chat mode.
  tools?: ToolDefinition[];
};

// Factory that creates and returns an agent function.
// All state (history, options) is captured in the closure.
export function createAgent(opts?: AgentOptions): AgentFn {
  // Running log of user ↔ assistant messages.
  // System messages are NOT stored here; they're prepended fresh on every
  // call so the system prompt is always the first message the model sees.
  const history: Message[] = [];

  return async (userMessage: string): Promise<string> => {
    // Echo stub: no provider → reflect the input back.
    // Useful for testing the full pipeline without API credentials.
    if (!opts?.provider) {
      return `Echo: ${userMessage}`;
    }

    // Append the user's message to history before calling the model.
    history.push({ role: "user", content: userMessage });

    // Build the full message list:
    //   [system prompt (if any)] + [all prior turns] + [current user message]
    const messages: Message[] = [];
    if (opts.systemPrompt) {
      messages.push({ role: "system", content: opts.systemPrompt });
    }
    messages.push(...history);

    // Call the provider. If tools are configured, the provider runs the
    // agentic loop internally and returns the final text reply.
    const reply = await opts.provider.chat(messages, opts.tools);

    // Store the assistant's reply so future turns have full context.
    history.push({ role: "assistant", content: reply });

    return reply;
  };
}
