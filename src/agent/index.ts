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

import type { Provider, TokenUsage } from "../providers/types.js";
import type { Message } from "../providers/types.js";
import { zeroUsage } from "../providers/types.js";
import type { ToolDefinition } from "../tools/types/types.js";

// The function signature every agent must satisfy.
export type AgentFn = (message: string, signal?: AbortSignal) => Promise<string>;

// Configuration passed to createAgent at construction time.
export type AgentOptions = {
  systemPrompt?: string;
  provider?: Provider;
  // Tools forwarded to the provider so the model can call them.
  // If omitted (or empty), the model operates in plain chat mode.
  tools?: ToolDefinition[];
  // Pre-populate the history with messages loaded from a saved session.
  // Pass the result of loadSession() here to resume a previous conversation.
  initialHistory?: Message[];
  // Called after every completed turn (user message + assistant reply) with
  // the full current history and the token usage for this turn. Use this to
  // persist new messages and accumulate session token counts incrementally.
  // The callback receives only the history snapshot — callers track the offset
  // of what's already been saved and slice accordingly (see register.chat.ts).
  onAfterTurn?: (history: Message[], usage: TokenUsage) => Promise<void>;
};

// Factory that creates and returns an agent function.
// All state (history, options) is captured in the closure.
export function createAgent(opts?: AgentOptions): AgentFn {
  // Running log of user ↔ assistant messages.
  // System messages are NOT stored here; they're prepended fresh on every
  // call so the system prompt is always the first message the model sees.
  // If initialHistory was provided (resuming a saved session), seed from it.
  const history: Message[] = opts?.initialHistory ? [...opts.initialHistory] : [];

  return async (userMessage: string, signal?: AbortSignal): Promise<string> => {
    // Echo stub: no provider → reflect the input back.
    // Still maintains history and fires onAfterTurn so sessions work even
    // without a real LLM (useful for testing the full pipeline).
    if (!opts?.provider) {
      const reply = `Echo: ${userMessage}`;
      history.push({ role: "user", content: userMessage });
      history.push({ role: "assistant", content: reply });
      if (opts?.onAfterTurn) await opts.onAfterTurn(history, zeroUsage());
      return reply;
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
    // agentic loop internally and returns the final text reply plus token usage.
    const { text: reply, usage } = await opts.provider.chat(messages, opts.tools, signal);

    // Store the assistant's reply so future turns have full context.
    history.push({ role: "assistant", content: reply });

    // Notify the caller that a full turn is complete. The caller uses this
    // to append the two new messages (user + assistant) to the session file
    // and record the token cost for this turn.
    if (opts?.onAfterTurn) {
      await opts.onAfterTurn(history, usage);
    }

    return reply;
  };
}
