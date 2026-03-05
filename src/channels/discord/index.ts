// channels/discord/index.ts
// --------------------------
// The Discord channel — lets the agent respond to messages inside Discord
// servers and DMs, just like the terminal channel does in the CLI.
//
// How it works:
//   1. A discord.js Client connects to Discord's gateway using the bot token.
//   2. On every incoming message the bot runs through an authorization checklist:
//        a. Is the author one of the configured commander IDs?  (always required)
//        b. If guildIds are configured: is the message from one of those guilds?
//        c. If channelIds are configured: is the message in one of those channels?
//           (when both guildIds AND channelIds are configured, BOTH must match)
//        d. Ignore the bot's own messages (prevents self-reply loops).
//        e. In a guild channel: the bot must be @mentioned in the message.
//           In a DM: no mention required — every message is implicitly addressed to the bot.
//   3. Authorized messages are forwarded to a per-user agent instance.
//      Each commander gets their own isolated conversation history so multiple
//      commanders don't bleed into each other's context.
//   4. The agent's reply is sent back to the same Discord channel.
//      Discord has a hard 2 000-character message limit, so long replies are
//      automatically split into sequential messages.
//
// Session persistence:
//   Each commander's conversation is stored under the session name
//   "discord-<userId>" using the same JSONL session system as the CLI chat.
//   Sessions resume automatically: if the bot restarts, each commander's
//   last N messages (historyLimit) are reloaded into context.
//
// Typing indicator:
//   While the agent is processing, the bot sends a typing indicator so the
//   user sees that something is happening (same UX as human Discord users).

import {
  Client,
  ChannelType,
  GatewayIntentBits,
  Partials,
  type Message as DiscordMessage,
} from "discord.js";
import type { DiscordConfig } from "../../config/index.js";
import type { AgentFn } from "../../agent/index.js";

// Discord's maximum message length. Any reply longer than this must be split
// into multiple messages to avoid the API rejecting them.
const DISCORD_MAX_LENGTH = 2_000;

export type DiscordChannelOptions = {
  // The validated Discord configuration (token, commander IDs, filters).
  config: DiscordConfig;
  // A factory that creates an agent for a given commander user ID.
  // Called once per unique commander on their first message; the returned
  // AgentFn is cached for all subsequent messages from that user.
  createAgentForUser: (userId: string) => Promise<AgentFn>;
};

// Split a long string into chunks of at most `maxLen` characters.
// Splits on newlines where possible to avoid cutting mid-sentence,
// falling back to a hard cut if a single line exceeds maxLen.
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at the last newline within the limit.
    const slice = remaining.slice(0, maxLen);
    const lastNewline = slice.lastIndexOf("\n");
    const splitAt = lastNewline > 0 ? lastNewline + 1 : maxLen;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter(Boolean);
}

// Returns true if the message was sent inside a DM channel (not a guild/server).
// discord.js exposes this via msg.channel.type; DMChannel has type DM.
function isDM(msg: DiscordMessage): boolean {
  return msg.channel.type === ChannelType.DM;
}

// Check whether an incoming Discord message passes all the authorization rules
// defined in the config. Returns true if the bot should process the message.
function isAuthorized(msg: DiscordMessage, config: DiscordConfig, botId: string): boolean {
  // Never respond to the bot's own messages — would cause infinite loops.
  if (msg.author.bot) return false;

  // The author must be a recognized commander.
  if (!config.commanderIds.has(msg.author.id)) return false;

  const dm = isDM(msg);

  // If guild restrictions are set, the message must come from an allowed guild.
  // DM messages have no guild (guildId is null) and are blocked when guildIds
  // is non-empty, since DMs can't belong to a specific guild.
  if (config.guildIds.size > 0) {
    if (!msg.guildId || !config.guildIds.has(msg.guildId)) return false;
  }

  // If channel restrictions are set, the message must come from an allowed channel.
  if (config.channelIds.size > 0) {
    if (!config.channelIds.has(msg.channelId)) return false;
  }

  // In guild channels the bot must be explicitly @mentioned — otherwise it
  // would respond to every message in the channel, which is too noisy.
  // In DMs there is no need to tag the bot; every message is implicitly for it.
  if (!dm && !msg.mentions.has(botId)) return false;

  return true;
}

// Start the Discord channel. Connects to Discord's gateway and begins
// listening for messages. Returns a cleanup function that logs out the bot.
//
// This function returns as soon as the bot is ready (connected). The actual
// message handling is event-driven and runs indefinitely until the returned
// stop() is called or the process exits.
export async function runDiscordChannel(opts: DiscordChannelOptions): Promise<{ stop: () => Promise<void> }> {
  // Per-user agent cache: userId → AgentFn.
  // Each commander gets an isolated agent with its own conversation history.
  const agentCache = new Map<string, AgentFn>();

  const client = new Client({
    intents: [
      // Receive guild messages (messages in servers).
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      // Receive direct messages sent to the bot.
      GatewayIntentBits.DirectMessages,
    ],
    // Required for the bot to receive DM events.
    partials: [Partials.Channel],
  });

  // Resolve or create the agent for a given Discord user ID.
  // The first call for a user creates and caches the agent;
  // subsequent calls return the cached instance so history is preserved.
  async function getAgent(userId: string): Promise<AgentFn> {
    if (!agentCache.has(userId)) {
      const agent = await opts.createAgentForUser(userId);
      agentCache.set(userId, agent);
    }
    return agentCache.get(userId)!;
  }

  client.on("messageCreate", async (msg: DiscordMessage) => {
    // client.user is guaranteed non-null after the "ready" event fires, and
    // messageCreate only fires after ready, so this is safe to assert.
    const botId = client.user!.id;

    // Run authorization checks before doing anything else.
    if (!isAuthorized(msg, opts.config, botId)) return;

    // Strip the @mention prefix from the message content before forwarding to
    // the agent — the agent doesn't need to see "<@botId>" as part of the prompt.
    const rawContent = msg.content
      .replace(new RegExp(`<@!?${botId}>`, "g"), "")
      .trim();

    const content = rawContent;
    if (!content) return;

    // Show a typing indicator so the user knows the bot is working.
    // We don't await this — if it fails (e.g. missing permissions) we
    // still want to process and reply.
    // PartialGroupDMChannel doesn't support sendTyping so we guard with an
    // "in" check before calling it.
    try {
      if ("sendTyping" in msg.channel) {
        await (msg.channel as { sendTyping: () => Promise<void> }).sendTyping();
      }
    } catch {
      // Typing indicator is cosmetic; ignore permission errors here.
    }

    try {
      const agent = await getAgent(msg.author.id);
      const reply = await agent(content);

      // Discord rejects messages longer than 2 000 characters.
      // Split and send sequentially so the reply arrives in order.
      const parts = splitMessage(reply, DISCORD_MAX_LENGTH);
      for (const part of parts) {
        await msg.reply(part);
      }
    } catch (error) {
      // Surface agent errors in the Discord channel so the commander
      // knows something went wrong without having to check server logs.
      const errMsg =
        error instanceof Error ? error.message : String(error);
      try {
        await msg.reply(`⚠️ Agent error: ${errMsg}`);
      } catch {
        // If we can't even send the error message, give up silently.
      }
    }
  });

  // Log to console when the bot successfully connects to Discord's gateway.
  client.once("ready", (c) => {
    console.log(`[cypherclaw] Discord connector ready — logged in as ${c.user.tag}`);

    const { commanderIds, channelIds, guildIds } = opts.config;
    console.log(`[cypherclaw] Authorized commanders: ${[...commanderIds].join(", ")}`);
    if (guildIds.size > 0) {
      console.log(`[cypherclaw] Restricted to guilds: ${[...guildIds].join(", ")}`);
    }
    if (channelIds.size > 0) {
      console.log(`[cypherclaw] Restricted to channels: ${[...channelIds].join(", ")}`);
    }
    if (guildIds.size === 0 && channelIds.size === 0) {
      console.log("[cypherclaw] No guild/channel restrictions — responding in all authorized locations.");
    }
  });

  // Connect to Discord's gateway. This resolves once the bot is ready.
  await client.login(opts.config.botToken);

  return {
    // Gracefully disconnect from Discord. After this, no more messageCreate
    // events will fire. Safe to call on SIGINT / process exit.
    stop: async () => {
      await client.destroy();
    },
  };
}
