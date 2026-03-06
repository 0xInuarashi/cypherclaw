// providers/anthropic.ts
// -----------------------
// Provider implementation for the Anthropic Messages API, including the
// agentic tool-calling loop.
//
// API reference: https://docs.anthropic.com/en/api/messages
//
// Anthropic's API differs from OpenAI's in two important ways:
//
//   1. System prompt — sent as a top-level "system" field, NOT as a message
//      with role "system". We extract it from the history before sending.
//
//   2. Tool calling format — entirely different schema:
//        Request tools:  { name, description, input_schema: { type, properties, required } }
//        Tool calls in response: content blocks with type "tool_use"
//        Tool results:   sent back as a "user" message containing blocks with
//                        type "tool_result" — NOT as a separate "tool" role.
//
// The agentic loop here mirrors openai-compatible.ts in structure but uses
// Anthropic's native types throughout.
//
// Request shape:
//   { model, max_tokens, system?, messages, tools? }
//   messages only contain role "user" | "assistant"
//   content can be a string OR an array of content blocks
//
// Response shape:
//   { content: ContentBlock[], stop_reason: "end_turn" | "tool_use" | ... }
//   ContentBlock: { type: "text", text } | { type: "tool_use", id, name, input }

import type { Message, Provider, TokenUsage } from "./types.js";
import { zeroUsage, addUsage } from "./types.js";
import type { ToolDefinition } from "../tools/types/types.js";
import type { DebugLogger } from "../debug/events.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8192;
const MAX_TOOL_ROUNDS = 100;

// ── Native Anthropic API types ───────────────────────────────────────────────

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type AnthropicToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

// Anthropic messages have structured content — either a plain string (for
// simple cases) or an array of typed content blocks (for tool interactions).
type AnthropicMessage =
  | { role: "user"; content: string | AnthropicContentBlock[] }
  | { role: "assistant"; content: string | AnthropicContentBlock[] };

type AnthropicResponse = {
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "tool_use" | string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

// Convert our ToolDefinition to Anthropic's tool schema.
// Key difference from OpenAI: the parameters field is called "input_schema".
function toAnthropicTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

// Convert our shared Message[] to Anthropic's native format.
// System messages are extracted separately; only user/assistant remain.
function toNativeMessages(messages: Message[]): AnthropicMessage[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

// ── Main factory ─────────────────────────────────────────────────────────────

export function createAnthropicProvider(opts: {
  apiKey: string;
  model: string;
  onEvent?: DebugLogger;
}): Provider {
  const emit = opts.onEvent ?? (() => {});

  return {
    async chat(messages: Message[], tools?: ToolDefinition[]): Promise<{ text: string; usage: TokenUsage }> {
      // Anthropic requires the system prompt as a top-level field.
      const systemMessage = messages.find((m) => m.role === "system");

      // Build the starting native message history (no system messages).
      const nativeMessages: AnthropicMessage[] = toNativeMessages(messages);

      // Prepare tools in Anthropic's format, or omit entirely if none.
      const anthropicTools =
        tools && tools.length > 0 ? tools.map(toAnthropicTool) : undefined;

      // Build a lookup map for O(1) tool resolution by name.
      const toolMap = new Map(tools?.map((t) => [t.name, t]) ?? []);

      let totalUsage: TokenUsage = zeroUsage();

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // Emit the outbound request so the debugger can show what's being sent.
        emit({ type: "llm_request", round: round + 1, messages, tools: tools ?? [] });

        // ── Step 1: call the API ────────────────────────────────────────────
        const requestBody: Record<string, unknown> = {
          model: opts.model,
          max_tokens: DEFAULT_MAX_TOKENS,
          messages: nativeMessages,
          ...(anthropicTools ? { tools: anthropicTools } : {}),
        };

        // Only include "system" if we actually have one.
        if (systemMessage) {
          requestBody["system"] = systemMessage.content;
        }

        // Emit the raw request body before sending so the full payload is visible.
        emit({ type: "llm_raw_request", body: requestBody });

        const res = await fetch(ANTHROPIC_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": opts.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Anthropic API error ${res.status}: ${text}`);
        }

        const data = (await res.json()) as AnthropicResponse;

        // Emit the raw response body exactly as received from the API.
        emit({ type: "llm_raw_response", body: data });

        // Parse and accumulate token usage for this round.
        const roundUsage: TokenUsage = {
          input: data.usage?.input_tokens ?? 0,
          output: data.usage?.output_tokens ?? 0,
          cacheRead: data.usage?.cache_read_input_tokens ?? 0,
          cacheCreation: data.usage?.cache_creation_input_tokens ?? 0,
        };
        totalUsage = addUsage(totalUsage, roundUsage);
        emit({ type: "llm_token_usage", round: round + 1, usage: roundUsage });

        // ── Step 2: plain text reply → we're done ──────────────────────────
        if (data.stop_reason === "end_turn") {
          const textBlock = data.content.find(
            (b): b is AnthropicTextBlock => b.type === "text",
          );
          if (!textBlock?.text) throw new Error("Anthropic returned an empty response");
          emit({ type: "llm_response_text", text: textBlock.text });
          return { text: textBlock.text, usage: totalUsage };
        }

        // ── Step 3: the model wants to call tools ──────────────────────────
        if (data.stop_reason !== "tool_use") {
          // Unexpected stop reason — return whatever text we have.
          const textBlock = data.content.find(
            (b): b is AnthropicTextBlock => b.type === "text",
          );
          return { text: textBlock?.text ?? "(no response)", usage: totalUsage };
        }

        // 3a. Record the assistant's full response (text + tool_use blocks)
        //     so the model knows what it requested in the next turn.
        nativeMessages.push({ role: "assistant", content: data.content });

        // 3b. Collect all tool_use blocks from the response.
        const toolUseBlocks = data.content.filter(
          (b): b is AnthropicToolUseBlock => b.type === "tool_use",
        );

        // 3c. Execute each tool call in parallel.
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (block): Promise<AnthropicToolResultBlock> => {
            const tool = toolMap.get(block.name);

            if (!tool) {
              const output = `Error: unknown tool "${block.name}"`;
              emit({ type: "tool_result", name: block.name, output });
              return { type: "tool_result", tool_use_id: block.id, content: output };
            }

            // Emit the call intent before executing.
            emit({ type: "llm_tool_call", name: block.name, args: block.input });

            const output = await tool.execute(block.input);

            emit({ type: "tool_result", name: block.name, output });
            return { type: "tool_result", tool_use_id: block.id, content: output };
          }),
        );

        // 3d. Anthropic requires tool results in a single "user" message
        //     containing an array of tool_result blocks — one per tool call.
        nativeMessages.push({ role: "user", content: toolResults });

        // 3e. Loop back to step 1.
      }

      throw new Error(`Agentic loop exceeded ${MAX_TOOL_ROUNDS} tool call rounds — total usage so far: ${JSON.stringify(totalUsage)}`);
    },
  };
}
