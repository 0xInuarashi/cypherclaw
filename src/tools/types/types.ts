// tools/types/types.ts
// ---------------
// The shared type that every tool must implement.
//
// A "tool" (also called a "function" in OpenAI's docs) is a capability we
// expose to the LLM so it can do things beyond just generating text — run
// shell commands, read files, call APIs, etc.
//
// How tool calling works at a high level:
//   1. We send the LLM a list of ToolDefinitions describing what tools exist.
//   2. Instead of replying with text, the model can "call" a tool by returning
//      a structured request: { name: "bash", args: { command: "ls -la" } }.
//   3. We execute the tool locally and send the output back to the model.
//   4. The model continues reasoning with that output, possibly calling more
//      tools, until it produces a final text reply for the user.
//
// The `execute` function is where the actual work happens — it's just a normal
// async function that does whatever the tool is supposed to do and returns a
// string (the output the model will see).

export type ToolDefinition = {
  // The machine-readable identifier the model uses when it wants to call this
  // tool. Must be unique and use only letters, numbers, underscores, and dashes.
  name: string;

  // A human-readable description the model reads to understand when and how to
  // use this tool. Be precise — the model decides whether to use a tool based
  // solely on this description.
  description: string;

  // A JSON Schema object describing the arguments this tool accepts.
  // The model uses this to know what values to pass.
  // "required" lists which properties the model must always provide.
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };

  // The function invoked by the agent when the model requests this tool.
  // Receives the model's arguments as a plain object and returns a string
  // result that gets fed back to the model as the tool's output.
  execute(args: Record<string, unknown>): Promise<string>;
};
