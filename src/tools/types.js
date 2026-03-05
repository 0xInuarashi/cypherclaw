"use strict";
// tools/types.ts
// ---------------
// The shared type that every tool must implement.
//
// A "tool" (also called a "function" in OpenAI's docs) is a capability we
// expose to the LLM so it can do things beyond just generating text — run
// shell commands, read files, call APIs, etc.
//
// How tool calling works at a high level:
//   1. We send the LLM a list of ToolDefinitions describing what tools exist.
//   2. Instead of replying with text, the model can "call" a tool by returning
//      a structured request: { name: "bash", args: { command: "ls -la" } }.
//   3. We execute the tool locally and send the output back to the model.
//   4. The model continues reasoning with that output, possibly calling more
//      tools, until it produces a final text reply for the user.
//
// The `execute` function is where the actual work happens — it's just a normal
// async function that does whatever the tool is supposed to do and returns a
// string (the output the model will see).
Object.defineProperty(exports, "__esModule", { value: true });
