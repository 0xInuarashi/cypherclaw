"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
