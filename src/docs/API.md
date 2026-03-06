# CypherClaw Gateway API

The CypherClaw gateway is a local HTTP server that connectors (Discord, Telegram, etc.) use to send messages to the agent and register themselves.

---

## Base URL

```
http://127.0.0.1:59152
```

The gateway binds exclusively to loopback. It is never reachable from outside the machine.

---

## Authentication

All endpoints except `GET /` require a **Bearer token**.

```
Authorization: Bearer <token>
```

Tokens are created by the user on the machine running CypherClaw:

```bash
cypherclaw token create discord
```

The token value is printed **once** at creation time. Copy it into your connector's config immediately. Tokens persist across daemon restarts and take effect without a restart.

To revoke a token:

```bash
cypherclaw token revoke discord
```

---

## Endpoints

### `GET /`

Health check. No authentication required.

**Response `200`**
```json
{
  "status": "ok",
  "pid": 12345
}
```

---

### `POST /chat`

Send a message to the agent and receive a reply.

**Request**
```json
{
  "message": "What is the weather like today?",
  "sessionId": "discord-channel-123456789"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | yes | The user's message text |
| `sessionId` | string | no | Identifies the conversation. If omitted, a new UUID is generated. Use a stable, unique identifier per conversation (e.g. a Discord channel ID or Telegram chat ID) to maintain history across turns. |

**Response `200`**
```json
{
  "reply": "I don't have access to live weather data, but...",
  "sessionId": "discord-channel-123456789"
}
```

**Response `400`** — `message` field missing or not a string.

**Response `401`** — Missing or invalid Bearer token.

**Response `503`** — The daemon started without valid LLM config (missing `CYPHERCLAW_PROVIDER` or API key). Restart the daemon with the correct environment variables.

---

### `GET /channels`

List all connectors currently registered with the gateway.

**Response `200`**
```json
{
  "channels": [
    {
      "name": "discord",
      "pid": 98765,
      "registeredAt": "2026-03-06T19:00:00.000Z"
    }
  ]
}
```

**Response `401`** — Missing or invalid Bearer token.

---

### `POST /channels/register`

Register this connector with the gateway. Call this once on connector startup. Re-registering with the same name overwrites the previous entry.

**Request**
```json
{
  "name": "discord",
  "pid": 98765
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Short identifier for this connector, e.g. `"discord"` |
| `pid` | number | yes | The connector's OS process ID |

**Response `200`**
```json
{ "ok": true }
```

**Response `400`** — `name` or `pid` missing or wrong type.

**Response `401`** — Missing or invalid Bearer token.

---

## Running the Gateway

### Development (local machine)

```bash
npm run gateway        # foreground — logs inline, Ctrl+C to stop
npm run gateway:start  # background daemon
npm run gateway:stop
npm run gateway:status
```

### Production (VPS)

Build once, then use the compiled output so the background daemon spawns correctly:

```bash
git clone <repo> cypherclaw && cd cypherclaw
npm install
cp .env.example .env   # fill in CYPHERCLAW_PROVIDER and your API key
npm run build
```

```bash
npm run prod:start     # start daemon (detaches — survives SSH logout)
npm run prod:status    # check running pid and port
npm run prod:stop      # graceful shutdown
```

The daemon inherits all env vars from the parent shell. `--env-file=.env` in the npm scripts handles this automatically.

### Token management

```bash
# dev
npx tsx --env-file=.env src/entry.ts token create <name>
npx tsx --env-file=.env src/entry.ts token list
npx tsx --env-file=.env src/entry.ts token revoke <name>

# prod (after build)
node --env-file=.env dist/entry.js token create <name>
node --env-file=.env dist/entry.js token list
node --env-file=.env dist/entry.js token revoke <name>
```

---

## Connector Quickstart

A minimal connector in Node.js:

```js
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const GATEWAY = "http://127.0.0.1:59152";

async function getToken(name) {
  const path = join(homedir(), ".cypherclaw", "tokens", `${name}.json`);
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw).token;
}

async function chat(token, message, sessionId) {
  const res = await fetch(`${GATEWAY}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`);
  return (await res.json()).reply;
}

async function register(token, name) {
  await fetch(`${GATEWAY}/channels/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ name, pid: process.pid }),
  });
}

const token = await getToken("discord");
await register(token, "discord");

const reply = await chat(token, "hello!", "channel-123");
console.log(reply);
```

---

## Session IDs

A `sessionId` is any stable string that identifies a conversation. Best practice per platform:

| Platform | Recommended sessionId |
|---|---|
| Discord | Channel ID, e.g. `"discord-1234567890"` |
| Telegram | Chat ID, e.g. `"telegram-9876543210"` |
| Slack | Channel + thread, e.g. `"slack-C0123-1709000000"` |
| Custom | Any UUID or opaque string |

The agent maintains separate conversation history per `sessionId`. History is persisted to disk so it survives daemon restarts.

---

## Error format

All error responses use the same shape:

```json
{ "error": "human-readable description" }
```
