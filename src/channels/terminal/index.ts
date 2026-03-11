// channels/terminal/index.ts
// ---------------------------
// The Terminal channel — the simplest possible messaging channel.
//
// In CypherClaw, a "channel" is any interface through which a user sends
// messages to the agent and receives replies. The terminal channel does this
// entirely inside the current process using Node's built-in `readline` module:
// it prints a prompt, waits for the user to type something and press Enter,
// forwards the input to the agent, then prints the agent's reply and repeats.
//
// This channel is deliberately decoupled from the agent. It receives an
// `AgentFn` (a plain async function) through its options, so it doesn't care
// whether the agent echoes text, calls an LLM, or queries a database — it just
// calls it and prints whatever comes back. This makes both the channel and the
// agent independently testable and replaceable.
//
// How to exit:
//   - Type "exit" or "quit" and press Enter.
//   - Press Ctrl+C at the prompt (when the agent is idle).
//
// How to interrupt:
//   - Press Ctrl+C while the agent is processing to abort the current turn
//     without ending the chat. The agent's in-flight API call and tool loop
//     are cancelled, and the prompt returns so you can continue chatting.

import readline from "node:readline";
import process from "node:process";
import type { AgentFn } from "../../agent/index.js";

export type TerminalChannelOptions = {
  // The agent function to call whenever the user sends a message.
  agent: AgentFn;
  // The text shown at the start of each input line. Defaults to "you> ".
  prompt?: string;
  // An existing readline interface to reuse instead of creating a new one.
  // Pass this when another part of the system (e.g. tool confirmation) also
  // needs to call rl.question() — sharing a single interface avoids two
  // readline instances fighting over stdin, which causes double-reads and
  // corrupted output.
  rl?: readline.Interface;
};

export async function runTerminalChannel(opts: TerminalChannelOptions): Promise<void> {
  const prompt = opts.prompt ?? "you> ";

  // Use the provided readline interface if one was passed in (e.g. when
  // --tool-confirm is active and the confirm wrapper needs the same instance).
  // Otherwise create a fresh one for this channel.
  const rl =
    opts.rl ??
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

  console.log('[cypherclaw] Terminal channel ready. Type "exit" or press Ctrl+C to quit.');
  console.log("[cypherclaw] Press Ctrl+C while the agent is running to interrupt.\n");

  // Tracks the AbortController for the currently in-flight agent turn.
  // When non-null, the agent is processing and Ctrl+C should interrupt it.
  // When null, the prompt is idle and Ctrl+C should exit the process.
  let currentAbort: AbortController | null = null;

  // Handle Ctrl+C: if the agent is running, abort the current turn and return
  // to the prompt. If the agent is idle (prompt showing), exit the chat.
  rl.on("SIGINT", () => {
    if (currentAbort) {
      currentAbort.abort();
      currentAbort = null;
      return;
    }
    console.log("\n[cypherclaw] Goodbye.");
    rl.close();
  });

  // The `ask` function represents one turn of the conversation loop.
  // It's defined as a named function (not a loop) so it can call itself
  // recursively after each response — this keeps the call stack flat and
  // avoids blocking readline while the agent is thinking.
  const ask = (): void => {
    rl.question(prompt, async (input) => {
      const trimmed = input.trim();

      // Allow the user to end the session explicitly.
      if (trimmed === "exit" || trimmed === "quit") {
        console.log("[cypherclaw] Goodbye.");
        rl.close(); // triggers the 'close' event below → process.exit
        return;
      }

      // Skip empty lines; just show the prompt again.
      if (!trimmed) {
        ask();
        return;
      }

      // Create a per-turn AbortController so Ctrl+C can cancel this turn.
      const ac = new AbortController();
      currentAbort = ac;

      // Pass the user's message to the agent and wait for a reply.
      try {
        const reply = await opts.agent(trimmed, ac.signal);
        console.log(`\nclaw> ${reply}\n`);
      } catch (error) {
        if (ac.signal.aborted) {
          console.log("\n[cypherclaw] Interrupted.\n");
        } else {
          // Don't crash on agent errors — print the problem and allow the user
          // to try again.
          console.error("[cypherclaw] Agent error:", error instanceof Error ? error.message : error);
        }
      } finally {
        currentAbort = null;
      }

      // Start the next turn.
      ask();
    });
  };

  // When the readline interface closes (Ctrl+C or rl.close() above), exit the
  // process so the CLI command returns cleanly.
  rl.on("close", () => {
    process.exit(0);
  });

  // Kick off the first turn.
  ask();
}
