// providers/openai-compatible.ts
// --------------------------------
// A shared agentic loop implementation for any API that speaks the OpenAI
// Chat Completions format. Both our OpenAI and OpenRouter providers delegate
// here — the only differences between them are the base URL, auth header
// value, and a couple of extra headers. The loop logic is identical.
//
// The agentic loop:
//   1. Send the conversation + tool definitions to the API.
//   2. If the model replies with plain text (finish_reason "stop") → done.
//   3. If the model wants to call tools (finish_reason "tool_calls"):
//        a. Add the assistant's message (containing the tool call requests)
//           to the native history so the model knows what it asked for.
//        b. Execute each requested tool in parallel.
//        c. Add one "role: tool" message per result so the model sees the
//           output of each call.
//        d. Go back to step 1 with the updated history.
//   4. Safety valve: cap at MAX_TOOL_ROUNDS to prevent infinite loops.
//
// Native OpenAI message types (internal to this file):
//   These differ from our shared Message type — they include tool-specific
//   roles ("tool") and structured tool_call fields that the API requires.

import type { Message, Provider, TokenUsage } from "./types.js";
import { zeroUsage, addUsage } from "./types.js";
import type { ToolDefinition } from "../tools/types/types.js";
import type { DebugLogger } from "../debug/events.js";
import { fetchWithRetry } from "../utils/fetch-utils.js";

// How many tool-call rounds to allow before giving up.
const MAX_TOOL_ROUNDS = 1000;

// ── Native OpenAI API types ──────────────────────────────────────────────────

type OAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON-encoded string
  };
};

// The full set of message shapes the OpenAI API accepts.
type OAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OAIResponse = {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

// Convert our shared Message type into the OpenAI native format.
function toNativeMessages(messages: Message[]): OAIMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

// Convert our ToolDefinition into the shape the OpenAI API expects.
function toOAITool(tool: ToolDefinition) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

// ── Main factory ─────────────────────────────────────────────────────────────

export type OpenAICompatibleOptions = {
  apiUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
  // Optional debug callback — fired at each significant point in the loop.
  // Omit (or pass undefined) for normal silent operation.
  onEvent?: DebugLogger;
};

export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): Provider {
  const emit = opts.onEvent ?? (() => {});

  return {
    async chat(messages: Message[], tools?: ToolDefinition[]): Promise<{ text: string; usage: TokenUsage }> {
      const nativeMessages: OAIMessage[] = toNativeMessages(messages);
      const oaiTools = tools && tools.length > 0 ? tools.map(toOAITool) : undefined;
      const toolMap = new Map(tools?.map((t) => [t.name, t]) ?? []);

      let totalUsage: TokenUsage = zeroUsage();

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // Emit the outbound request so the debugger can show what's being sent.
        emit({ type: "llm_request", round: round + 1, messages, tools: tools ?? [] });

        // ── Step 1: call the API ──────────────────────────────────────────────
        const requestBody = {
          model: opts.model,
          messages: nativeMessages,
          ...(oaiTools ? { tools: oaiTools } : {}),
        };

        // Emit the raw request body before sending so the full payload is visible.
        emit({ type: "llm_raw_request", body: requestBody });

        const data = await fetchWithRetry(async () => {
          const res = await fetch(opts.apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${opts.apiKey}`,
              ...opts.extraHeaders,
            },
            body: JSON.stringify(requestBody),
          });
          if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
          const json = (await res.json()) as OAIResponse;
          if (!json.choices?.length) throw new Error(`API returned no choices: ${JSON.stringify(json)}`);
          return json;
        }, emit);

        // Emit the raw response body exactly as received from the API.
        emit({ type: "llm_raw_response", body: data });

        // Parse and accumulate token usage for this round.
        const roundUsage: TokenUsage = {
          input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0,
          cacheRead: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          cacheCreation: 0,
        };
        totalUsage = addUsage(totalUsage, roundUsage);
        emit({ type: "llm_token_usage", round: round + 1, usage: roundUsage });

        const choice = data.choices[0];

        // ── Step 2: plain text reply → we're done ────────────────────────────
        if (choice.finish_reason === "stop" || !choice.message.tool_calls?.length) {
          const text = choice.message.content;
          if (!text) {
            // Model returned a stop with no content — retry the same round.
            emit({ type: "llm_raw_request", body: { _retry: "empty_response", round: round + 1 } });
            continue;
          }
          emit({ type: "llm_response_text", text });
          return { text, usage: totalUsage };
        }

        // ── Step 3: the model wants to call tools ────────────────────────────

        // 3a. Record the assistant's message in native history.
        nativeMessages.push({
          role: "assistant",
          content: choice.message.content ?? null,
          tool_calls: choice.message.tool_calls,
        });

        // 3b+c. Execute each tool call and collect results.
        const results = await Promise.all(
          choice.message.tool_calls.map(async (toolCall) => {
            const name = toolCall.function.name;
            const tool = toolMap.get(name);

            if (!tool) {
              const output = `Error: unknown tool "${name}"`;
              emit({ type: "tool_result", name, output });
              return { tool_call_id: toolCall.id, output };
            }

            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
            } catch {
              const output = `Error: could not parse tool arguments: ${toolCall.function.arguments}`;
              emit({ type: "tool_result", name, output });
              return { tool_call_id: toolCall.id, output };
            }

            // Emit the call intent before executing so the user sees it immediately.
            emit({ type: "llm_tool_call", name, args });

            const output = await tool.execute(args);

            emit({ type: "tool_result", name, output });
            return { tool_call_id: toolCall.id, output };
          }),
        );

        // Add one "role: tool" message per result.
        for (const result of results) {
          nativeMessages.push({
            role: "tool",
            tool_call_id: result.tool_call_id,
            content: result.output,
          });
        }

        // 3d. Loop back to step 1.
      }

      throw new Error(`Agentic loop exceeded ${MAX_TOOL_ROUNDS} tool call rounds — total usage so far: ${JSON.stringify(totalUsage)}`);
    },
  };
}
