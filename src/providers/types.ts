// providers/types.ts
// -------------------
// Shared types that every provider implementation must use.
//
// The key design decision here is the Provider interface: all three providers
// (OpenAI, Anthropic, OpenRouter) implement the same `chat()` method. This
// means the agent doesn't need to know which provider is active — it just calls
// `provider.chat(history)` and gets a string back.
//
// Message roles:
//   "system"    — Instructions given to the model before the conversation
//                 starts. Sets the persona, constraints, and goals of the agent.
//                 Sent once at the beginning of every request.
//   "user"      — A message from the human.
//   "assistant" — A previous reply from the model. Included in the history so
//                 the model has context about what it already said.

// A single message in a conversation.
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

// The interface every provider must satisfy.
// `chat` receives the full conversation history (including the system prompt
// prepended by the agent) and returns the model's next reply as a plain string.
export type Provider = {
  chat(messages: Message[]): Promise<string>;
};
