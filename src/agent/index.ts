// agent/index.ts
// ---------------
// The agent is the "brain" of CypherClaw — it receives a user message,
// maintains the conversation history, calls the LLM provider, and returns the
// model's reply.
//
// Architecture note:
//   The agent is expressed as a plain async function type (`AgentFn`) rather
//   than a class. This keeps things composable: any function that takes a
//   string and returns a Promise<string> qualifies as an agent. The channel
//   (e.g. terminal) calls the agent without caring about its internals, and the
//   agent doesn't know or care which channel it's running inside.
//
// Conversation history:
//   Large language models are stateless — every API call is independent. To
//   simulate a "memory" across turns we maintain a local array of all messages
//   sent and received so far. On each call we prepend the system prompt (if
//   set) and append the full history, giving the model full context.
//
// AgentOptions:
//   `systemPrompt` — instruction string sent to the model before any user
//                    messages. Sets the persona, constraints, and goals of the
//                    agent. Maps to the "system" role in the message array.
//   `provider`     — a concrete Provider instance (openai / anthropic /
//                    openrouter) created by createProvider() in providers/index.

import type { Provider } from "../providers/types.js";
import type { Message } from "../providers/types.js";

// The function signature every agent must satisfy.
// Takes a plain-text user message, returns the agent's reply.
export type AgentFn = (message: string) => Promise<string>;

// Configuration passed to createAgent at construction time.
export type AgentOptions = {
  // Optional instruction string sent as the "system" role at the top of every
  // request. Tells the model who it is and how it should behave.
  systemPrompt?: string;
  // The LLM provider to call. If omitted the agent falls back to an echo stub
  // so the rest of the pipeline can be tested without API credentials.
  provider?: Provider;
};

// Factory function that creates and returns an agent function.
// All state (history, options) is captured in the closure — no class needed.
export function createAgent(opts?: AgentOptions): AgentFn {
  // The running log of user and assistant messages in this conversation session.
  // System messages are NOT stored here; they're prepended fresh on every call
  // so that the system prompt is always the first message the model sees.
  const history: Message[] = [];

  return async (userMessage: string): Promise<string> => {
    // If no real provider was supplied, echo back so the pipeline is testable
    // without any API key or network connection.
    if (!opts?.provider) {
      return `Echo: ${userMessage}`;
    }

    // Add the user's message to the running history before calling the model.
    history.push({ role: "user", content: userMessage });

    // Build the full message list to send:
    //   [system prompt (if any)] + [all prior turns] + [current user message]
    // The system prompt is reconstructed each time rather than stored once in
    // history, so we can potentially swap it between turns in the future.
    const messages: Message[] = [];
    if (opts.systemPrompt) {
      messages.push({ role: "system", content: opts.systemPrompt });
    }
    messages.push(...history);

    // Call the provider and get the model's reply.
    const reply = await opts.provider.chat(messages);

    // Store the assistant's reply so subsequent turns have full context.
    history.push({ role: "assistant", content: reply });

    return reply;
  };
}
