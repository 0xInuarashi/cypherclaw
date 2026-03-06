// cli/program/commands.ts
// -----------------------
// Central registry: imports every command's registration function and calls
// them in order against the root Commander program.
//
// Adding a new command to the CLI is a two-step process:
//   1. Create a new  cli/program/register.<name>.ts  file that exports a
//      registerXxxCommand(program) function.
//   2. Import and call it here.
//
// This keeps each command's logic isolated and makes it easy to see the full
// list of available commands at a glance.

import type { Command } from "commander";
import { registerChatCommand } from "./register.chat.js";
import { registerSessionsCommand } from "./register.sessions.js";
import { registerStartCommand } from "./register.start.js";
import { registerStatusCommand } from "./register.status.js";
import { registerStopCommand } from "./register.stop.js";
import { registerTokenCommand } from "./register.token.js";

export function registerCommands(program: Command): void {
  registerStartCommand(program);    // cypherclaw start
  registerStopCommand(program);     // cypherclaw stop
  registerStatusCommand(program);   // cypherclaw status
  registerChatCommand(program);     // cypherclaw chat  (--session, --debug, --raw, --tool-confirm)
  registerSessionsCommand(program); // cypherclaw sessions list / delete
  registerTokenCommand(program);    // cypherclaw token create / list / revoke
}
