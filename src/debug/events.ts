// debug/events.ts
// ----------------
// Typed events that flow through the provider agentic loop.
//
// Providers emit these events at key moments so that observers (like the
// chat-debug command) can log exactly what's happening inside the loop
// without the providers needing to know anything about how the events are
// displayed.
//
// Design: a simple callback (`DebugLogger`) rather than an EventEmitter.
// This is intentionally minimal — no dependency needed, easy to test, and
// the synchronous callback model is fine since logging is fire-and-forget.

import type { Message } from "../providers/types.js";
import type { ToolDefinition } from "../tools/types.js";

// Every event the provider can emit, as a discriminated union.
// The `type` field lets the logger switch on the event kind.
export type DebugEvent =
  // Fired before each HTTP call to the LLM API.
  // Includes the full message array and tool list being sent.
  | {
      type: "llm_request";
      round: number; // which iteration of the agentic loop (1-based)
      messages: Message[];
      tools: ToolDefinition[];
    }

  // Fired with the exact JSON body we are about to POST to the API.
  // No parsing — this is the raw object that will be JSON.stringify'd.
  | {
      type: "llm_raw_request";
      body: unknown;
    }

  // Fired with the exact parsed JSON body we received from the API.
  // No parsing — this is whatever the API returned before we inspect it.
  | {
      type: "llm_raw_response";
      body: unknown;
    }

  // Fired when the model's final text reply is received.
  | {
      type: "llm_response_text";
      text: string;
    }

  // Fired once per tool call the model requests (before execution).
  | {
      type: "llm_tool_call";
      name: string;
      args: Record<string, unknown>;
    }

  // Fired once per tool call after the tool has finished executing.
  | {
      type: "tool_result";
      name: string;
      output: string;
    };

// The callback type providers accept.
// Called synchronously inside the loop — keep implementations fast.
export type DebugLogger = (event: DebugEvent) => void;
