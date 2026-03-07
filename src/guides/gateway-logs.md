# Reading Gateway Logs

The CypherClaw gateway daemon writes all of its output to a persistent log file on disk. This guide explains where the file is, what each log line means, and how to use it to diagnose problems with a running gateway.

---

## Log File Location

```
~/.cypherclaw/gateway/gateway.log
```

The directory is created automatically on first gateway start. The file uses **append mode** — every daemon start adds to the end of the same file. Successive restarts are separated by a timestamped banner so you can always tell sessions apart.

---

## Reading the Log

### Tail live output (most useful while debugging)

```bash
tail -f ~/.cypherclaw/gateway/gateway.log
```

### Read the full file

```bash
cat ~/.cypherclaw/gateway/gateway.log
```

### Show only the last N lines

```bash
tail -n 200 ~/.cypherclaw/gateway/gateway.log
```

### Find entries from the most recent daemon start

Each start writes a banner like this:

```
────────────────────────────────────────────────────────────────────────
[cypherclaw] Gateway daemon starting at 2025-01-15T14:32:01.123Z
────────────────────────────────────────────────────────────────────────
```

To jump to the last banner:

```bash
grep -n "Gateway daemon starting" ~/.cypherclaw/gateway/gateway.log | tail -1
```

Then read from that line number onward:

```bash
tail -n +<LINE_NUMBER> ~/.cypherclaw/gateway/gateway.log
```

---

## Log Line Reference

### Startup

| Log line | Meaning |
|---|---|
| `[cypherclaw] Gateway daemon starting at <ISO timestamp>` | Daemon process started, about to boot the HTTP server |
| `[cypherclaw] Gateway daemon starting at <timestamp> [debug]` | Started with `--debug` flag active |
| `[cypherclaw] Gateway daemon starting at <timestamp> [raw]` | Started with `--raw` flag active |
| `[cypherclaw] Gateway started on 127.0.0.1:59152 (pid <N>)` | HTTP server is listening and ready to accept requests |

### Runtime

| Log line | Meaning |
|---|---|
| `[cypherclaw] Channel registered: <name> (pid <N>)` | A connector (e.g. Discord) called `POST /channels/register` |
| `[cypherclaw] Gateway request error: <details>` | An unhandled exception occurred inside a request handler |

### Agent / LLM bootstrap

| Log line | Meaning |
|---|---|
| `[cypherclaw] Agent unavailable — <reason>` | LLM config missing or invalid; `/chat` will return 503 |
| `[cypherclaw] POST /chat will return 503 until restarted with valid config.` | Follows the line above; confirms chat is disabled |

---

## Verbosity Flags

By default the log contains only gateway lifecycle messages (startup, shutdown, channel registrations, errors). Two flags make it significantly more detailed:

### `--debug`

Logs the high-level agentic loop for every `/chat` request:

- Which round of the loop is executing
- All messages in context (roles + truncated content)
- Every tool call the model requested, with its arguments
- Every tool result returned to the model
- The final text reply
- Token usage per round

Start the gateway with this flag:

```bash
npm run gateway:start -- --debug
```

Example log output:

```
[llm ↑] round 1 · 3 messages · tools: bash, read_file
  system    · You are a helpful assistant.
  user      · what files are in /tmp?
  assistant · (tool call)

[llm ↓] tool_call  bash
  {"command":"ls /tmp"}

[tool ✓] bash
  │ cypherclaw.pid
  │ cypherclaw-gateway.log

[llm ↓] text
  │ The /tmp directory contains: cypherclaw.pid, cypherclaw-gateway.log
```

### `--raw`

Logs the exact JSON bodies sent to and received from the LLM API — nothing is parsed or summarised. Useful when diagnosing provider errors or unexpected model behaviour.

```bash
npm run gateway:start -- --raw
```

Example log output:

```
[raw ↑] request body
  │ { "model": "claude-opus-4-5", "messages": [...], "tools": [...] }

[raw ↓] response body
  │ { "id": "msg_...", "content": [...], "usage": { "input_tokens": 412, ... } }
```

Both flags can be combined:

```bash
npm run gateway:start -- --debug --raw
```

---

## Diagnosing Common Problems

### Gateway starts but `/chat` returns 503

Look for these lines near the start banner:

```
[cypherclaw] Agent unavailable — <reason>
[cypherclaw] POST /chat will return 503 until restarted with valid config.
```

The `<reason>` will tell you what is missing — typically an environment variable for the API key, model name, or provider. Fix the `.env` file and restart the gateway.

### A connector cannot register (401 errors in connector logs)

The connector's token is invalid or has been revoked. Verify with:

```bash
cypherclaw token list
```

Revoke the old token and create a new one:

```bash
cypherclaw token revoke <name>
cypherclaw token create <name>
```

### Requests are hanging or timing out

Run with `--debug` and watch the log. A hang typically shows the `[llm ↑]` line for a round but no `[llm ↓]` following it, meaning the API call itself is stalled. Check network connectivity and the provider's API status.

### The log file is very large

The log file is never automatically rotated. To clear it while the daemon is running:

```bash
truncate -s 0 ~/.cypherclaw/gateway/gateway.log
```

This empties the file without closing the file descriptor the daemon holds, so logging continues correctly from that point.

---

## Notes for Foreground Mode

When the gateway is started with `--foreground` (via `npm run gateway` or `npm run gateway:dev`), output goes directly to the terminal and **not** to the log file. The log file is only written by the background daemon.
