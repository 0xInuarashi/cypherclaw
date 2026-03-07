// gateway/bootstrap.ts
// ---------------------
// Shared agent bootstrap logic used by both the background daemon and the
// foreground start path.
//
// Attempts to load LLM config from env and build an agent session factory.
// On failure it logs a warning and returns undefined — the caller passes this
// to startGatewayServer, which then returns 503 on POST /chat until the
// process is restarted with valid config.

import type { AgentFn } from "../agent/index.js";
import type { DebugLogger } from "../debug/events.js";

export type AgentFactory = (sessionId: string) => Promise<AgentFn>;

export type AgentFactoryOpts = {
  onEvent?: DebugLogger;
};

export async function buildAgentFactory(opts?: AgentFactoryOpts): Promise<AgentFactory | undefined> {
  try {
    const { loadConfig } = await import("../config/index.js");
    const { createProvider } = await import("../providers/index.js");
    const { createAgent } = await import("../agent/index.js");
    const { createSessionTools } = await import("../tools/index.js");
    const { DEFAULT_SYSTEM_PROMPT } = await import("../agent/system-prompt.js");
    const { loadSession, appendToSession, appendSessionTokens, DEFAULT_HISTORY_LIMIT } =
      await import("../sessions/index.js");

    const config = loadConfig();
    const provider = createProvider(config, opts?.onEvent);
    const userAddition = process.env.CYPHERCLAW_SYSTEM_PROMPT;
    const systemPromptTemplate = userAddition
      ? `${DEFAULT_SYSTEM_PROMPT}\n\n${userAddition}`
      : DEFAULT_SYSTEM_PROMPT;

    const agentSessions = new Map<string, AgentFn>();

    return async (sessionId: string): Promise<AgentFn> => {
      const cached = agentSessions.get(sessionId);
      if (cached) return cached;

      const initialHistory = (await loadSession(sessionId, DEFAULT_HISTORY_LIMIT)) ?? [];
      let savedMessageCount = initialHistory.length;

      const agent = createAgent({
        systemPrompt: systemPromptTemplate.replace(/\{\{SESSION_ID\}\}/g, sessionId),
        provider,
        tools: createSessionTools(sessionId),
        initialHistory: initialHistory.length > 0 ? initialHistory : undefined,
        onAfterTurn: async (history, usage) => {
          const newMessages = history.slice(savedMessageCount);
          if (newMessages.length > 0) {
            await appendToSession(sessionId, newMessages);
            savedMessageCount = history.length;
          }
          await appendSessionTokens(sessionId, usage);
        },
      });

      agentSessions.set(sessionId, agent);
      return agent;
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[cypherclaw] Agent unavailable — ${reason}`);
    console.warn("[cypherclaw] POST /chat will return 503 until restarted with valid config.");
    return undefined;
  }
}
