"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommands = registerCommands;
var register_chat_js_1 = require("./register.chat.js");
var register_sessions_js_1 = require("./register.sessions.js");
var register_start_js_1 = require("./register.start.js");
var register_status_js_1 = require("./register.status.js");
var register_stop_js_1 = require("./register.stop.js");
function registerCommands(program) {
    (0, register_start_js_1.registerStartCommand)(program); // cypherclaw start
    (0, register_stop_js_1.registerStopCommand)(program); // cypherclaw stop
    (0, register_status_js_1.registerStatusCommand)(program); // cypherclaw status
    (0, register_chat_js_1.registerChatCommand)(program); // cypherclaw chat  (--session, --debug, --raw, --tool-confirm)
    (0, register_sessions_js_1.registerSessionsCommand)(program); // cypherclaw sessions list / delete
}
