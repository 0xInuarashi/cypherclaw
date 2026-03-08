// tools/tts.ts
// ------------
// Converts text to speech using Microsoft Edge's read-aloud service via
// WebSocket, writing the audio to a file on disk.
//
// No API key required — this piggybacks on the same endpoint the Edge browser
// uses for its built-in read-aloud feature. The connection is authenticated
// via a time-based token (Sec-MS-GEC) derived from a hardcoded trusted client
// token. The token rotates every ~5 minutes; the derivation is done on every
// call so it is always fresh.
//
// Protocol overview:
//   1. Open a WebSocket to speech.platform.bing.com with a spoofed Edge UA.
//   2. Send a speech.config JSON message to set the output format.
//   3. Send an SSML synthesis request.
//   4. Receive binary audio frames (streamed) → write to disk.
//   5. Receive Path:turn.end → close socket, resolve.
//
// Dependencies: ws (WebSocket), node:crypto, node:fs, node:path, node:os.
// No proxy support — omitted intentionally (not needed for server deployments).

import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolDefinition } from "./types/types.js";

import WebSocket from "ws";

// ── DRM / auth ────────────────────────────────────────────────────────────────

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const WINDOWS_FILE_TIME_EPOCH = 11_644_473_600n;

export function generateSecMsGecToken(): string {
  const ticks =
    BigInt(Math.floor(Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH)) *
    10_000_000n;
  const rounded = ticks - (ticks % 3_000_000_000n);
  return createHash("sha256")
    .update(`${rounded}${TRUSTED_CLIENT_TOKEN}`, "ascii")
    .digest("hex")
    .toUpperCase();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function langFromVoice(voice: string): string {
  const match = voice.match(/^([a-z]{2}-[A-Z]{2})/);
  return match ? match[1] : "en-US";
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<":  return "&lt;";
      case ">":  return "&gt;";
      case "&":  return "&amp;";
      case '"':  return "&quot;";
      case "'":  return "&apos;";
      default:   return c;
    }
  });
}

// ── Core TTS function ─────────────────────────────────────────────────────────

type TtsParams = {
  text: string;
  outputPath: string;
  voice?: string;
  outputFormat?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  timeoutMs?: number;
};

function edgeTts(params: TtsParams): Promise<void> {
  const {
    text,
    outputPath,
    voice = "en-US-AriaNeural",
    outputFormat = "audio-24khz-96kbitrate-mono-mp3",
    rate = "default",
    pitch = "default",
    volume = "default",
    timeoutMs = 15_000,
  } = params;

  const lang = langFromVoice(voice);

  return new Promise((resolve, reject) => {
    const gecToken = generateSecMsGecToken();
    const wsUrl =
      `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
      `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${gecToken}` +
      `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;

    const ws = new WebSocket(wsUrl, {
      host: "speech.platform.bing.com",
      origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      headers: {
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "User-Agent":
          `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
          `(KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split(".")[0]}.0.0.0 ` +
          `Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split(".")[0]}.0.0.0`,
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const audioStream = createWriteStream(outputPath);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error("TTS request timed out"));
    }, timeoutMs);

    function finish(err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      if (err) {
        reject(err);
      } else {
        audioStream.end(() => resolve());
      }
    }

    ws.on("error", (err: Error) => finish(err));

    ws.on("open", () => {
      ws.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: "false",
                  wordBoundaryEnabled: "false",
                },
                outputFormat,
              },
            },
          },
        })
      );

      const requestId = randomBytes(16).toString("hex");
      ws.send(
        `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
        `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
        `<voice name="${voice}">` +
        `<prosody rate="${rate}" pitch="${pitch}" volume="${volume}">` +
        `${escapeXml(text)}` +
        `</prosody></voice></speak>`
      );
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const separator = "Path:audio\r\n";
        const idx = data.indexOf(separator) + separator.length;
        audioStream.write(data.subarray(idx));
      } else {
        const msg = data.toString();
        if (msg.includes("Path:turn.end")) {
          finish();
        }
      }
    });
  });
}

// ── Tool definition ───────────────────────────────────────────────────────────

const AUDIO_SUBDIR = path.join(os.homedir(), ".cypherclaw", "tts");

export const ttsTool: ToolDefinition = {
  name: "tts",
  description:
    "Convert text to speech and save the audio to a file. " +
    "Uses Microsoft Edge's read-aloud service — no API key required. " +
    "Returns the path to the generated audio file (mp3). " +
    "Use this when the user asks to generate speech, read something aloud, or produce an audio file from text.",

  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to convert to speech.",
      },
      filename: {
        type: "string",
        description:
          "Output filename (without directory). Defaults to a timestamped name. " +
          "Should end in .mp3 unless you are changing output_format.",
      },
      voice: {
        type: "string",
        description:
          "Edge neural voice name. Defaults to en-US-AriaNeural. " +
          "Examples: en-US-GuyNeural, en-GB-SoniaNeural, fr-FR-DeniseNeural.",
      },
      rate: {
        type: "string",
        description: "Speaking rate. Examples: default, +20%, -10%, fast, slow.",
      },
      pitch: {
        type: "string",
        description: "Voice pitch. Examples: default, +5Hz, -10%.",
      },
      volume: {
        type: "string",
        description: "Volume level. Examples: default, +20%, -30%, loud, soft.",
      },
      output_format: {
        type: "string",
        description:
          "Audio output format. Defaults to audio-24khz-96kbitrate-mono-mp3. " +
          "Other options: audio-16khz-32kbitrate-mono-mp3, audio-48khz-96kbitrate-mono-mp3.",
      },
    },
    required: ["text"],
  },

  async execute(args): Promise<string> {
    const text = args["text"] as string;
    const voice = args["voice"] as string | undefined;
    const rate = args["rate"] as string | undefined;
    const pitch = args["pitch"] as string | undefined;
    const volume = args["volume"] as string | undefined;
    const outputFormat = args["output_format"] as string | undefined;
    const filename =
      (args["filename"] as string | undefined) ??
      `tts-${Date.now()}.mp3`;

    const outputPath = path.join(AUDIO_SUBDIR, filename);

    process.stderr.write(`\x1b[33m[tts]\x1b[0m ${JSON.stringify(text.slice(0, 80))}${text.length > 80 ? "…" : ""} → ${outputPath}\n`);

    mkdirSync(AUDIO_SUBDIR, { recursive: true });

    try {
      await edgeTts({ text, outputPath, voice, rate, pitch, volume, outputFormat });
      return `Audio saved to: ${outputPath}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `TTS failed: ${message}`;
    }
  },
};
