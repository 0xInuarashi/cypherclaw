# Install Discord Connector

This guide walks you through installing the CypherClaw Discord Connector, which connects CypherClaw to a Discord bot so users can interact with you via @mentions or DMs.

---

## Before You Start

Collect the following from the user before running any commands:

| Item | How to get it |
|---|---|
| **Discord bot token** | [Discord Developer Portal](https://discord.com/developers/applications) → their app → Bot → Reset Token |
| **Owner Discord user ID(s)** | Discord Settings → Advanced → enable Developer Mode, then right-click username → Copy User ID. Multiple IDs are comma-separated. Use `000000000000` to allow anyone. |
| **Guild IDs** *(optional)* | Right-click server icon → Copy Server ID (requires Developer Mode) |
| **Channel IDs** *(optional)* | Right-click channel → Copy Channel ID (requires Developer Mode) |

> **Important:** In the Discord Developer Portal, under Bot → Privileged Gateway Intents, enable **Message Content Intent** — otherwise the bot will receive messages with empty content.

Do not proceed without the bot token and at least one owner ID.

---

## Step 1 — Check Prerequisites

Run these checks and stop if any fail:

```bash
node --version
```
Must be `v20.x.x` or higher.

```bash
git --version
```

```bash
curl -s http://127.0.0.1:59152/
```
Expected: `{"status":"ok","pid":<number>}`. If this fails, the CypherClaw daemon is not running — ask the user to start it first.

---

## Step 2 — Create a CypherClaw Channel Token

```bash
cypherclaw token create discord
```

Copy the printed token immediately — it is only shown once. This is your `--cypherclaw-token` value.

---

## Step 3 — Clone and Install

```bash
git clone https://github.com/0xinuarashi/cypherclaw-discord-connector cypherclaw-discord-connector
cd cypherclaw-discord-connector
npm install
```

---

## Step 4 — Run Setup

Use the information from the prerequisites and the token from Step 2.

**Minimum (required flags only):**
```bash
npm run setup -- \
  --bot-token <discord_bot_token> \
  --cypherclaw-token <cypherclaw_token> \
  --owners <owner_id>
```

**With optional guild and channel restrictions:**
```bash
npm run setup -- \
  --bot-token <discord_bot_token> \
  --cypherclaw-token <cypherclaw_token> \
  --owners <owner_id1,owner_id2> \
  --guilds <guild_id1,guild_id2> \
  --channels <channel_id1,channel_id2>
```

**Allow anyone to use the bot:**
```bash
npm run setup -- \
  --bot-token <discord_bot_token> \
  --cypherclaw-token <cypherclaw_token> \
  --owners 000000000000
```

Expected output: `[setup] Created .env` followed by `[setup] Done. Run: npm start`

---

## Step 5 — Start the Connector

**As a daemon (recommended):**
```bash
npm run start:daemon
```
Expected: `[daemon] Started (pid <number>). Logs: /tmp/cypherclaw-discord.log`

**Foreground (for debugging):**
```bash
npm start
```
Expected output (in order):
1. `[cypherclaw-discord] Registered with CypherClaw gateway.`
2. `[bot] Logged in as <BotName>#<discriminator>`

If gateway registration fails with a 401, the `--cypherclaw-token` is invalid — re-run Steps 2 and 4.  
If the bot login fails, the `--bot-token` is invalid — ask the user to regenerate it from the Discord Developer Portal.

---

## Managing the Connector

### Daemon Control

| Command | Description |
|---|---|
| `npm run start:daemon` | Start in background |
| `npm run stop` | Stop the daemon |
| `npm run status` | Check if running |
| `npm run logs` | Tail live logs |

### Managing Owners, Guilds, and Channels

Changes take effect on the next start.

```bash
npm run manage -- add owner <id1,id2>
npm run manage -- remove owner <id>
npm run manage -- add guild <id1,id2>
npm run manage -- remove guild <id>
npm run manage -- add channel <id1,id2>
npm run manage -- remove channel <id>
npm run manage -- list
```

### Reconfiguring from Scratch

Re-run Step 4 with new flags — it overwrites the existing `.env`.

To revoke the CypherClaw token:
```bash
cypherclaw token revoke discord
```

---

## Bot Behavior

- **Guild channels**: responds only when @mentioned, and only from allowed owners.
- **DMs**: responds to any message, but only from allowed owners.
- **Filtering**: if guilds are configured, messages from other guilds are ignored. If channels are also configured, only those channels within those guilds are active.
- **Sessions**: each Discord channel gets its own conversation session (`discord-<channelId>-<uuid>`), scoped to the current connector run.
