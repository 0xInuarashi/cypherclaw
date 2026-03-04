// cli/program.ts
// --------------
// Constructs and returns the root Commander program object.
//
// Commander is the library we use to parse CLI arguments. The "program" is the
// top-level object that represents the `cypherclaw` command itself. All
// sub-commands (start, stop, status, chat) are attached to it.
//
// This file keeps things minimal — it just wires the name/description/version
// metadata onto the program and then delegates actual command registration to
// cli/program/commands.ts so each command lives in its own file.

import { Command } from "commander";
import { registerCommands } from "./program/commands.js";

export function buildProgram(): Command {
  const program = new Command();

  // Top-level metadata shown in --help output.
  program
    .name("cypherclaw")
    .description("A personal AI assistant")
    .version("0.1.0");

  // Attach all sub-commands. Each command is defined in its own
  // register.*.ts file inside cli/program/.
  registerCommands(program);

  return program;
}
