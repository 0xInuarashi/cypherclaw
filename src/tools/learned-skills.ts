// tools/learned-skills.ts
// -----------------------
// A self-maintained knowledge base where the agent records techniques,
// patterns, and solutions it discovers during tasks.
//
// Unlike memory (a general scratchpad) or skills (curated read-only packs),
// learned_skills are structured, agent-authored guides that grow over time.
// The agent should:
//   - After completing a non-trivial task, decide whether the approach is
//     worth saving as a learned skill for future reuse.
//   - Before starting a task, search learned skills for relevant prior
//     knowledge that could short-circuit the work.
//   - Periodically revise or append to skills as understanding improves.
//
// Skills live in ~/.cypherclaw/learned-skills/ as plain Markdown files.
// The filename (without .md) is the skill's identifier.
// The first # heading (or first non-empty line) is used as the summary
// when listing.
//
// Five tools are exported:
//   list_learned_skills   — list all learned skills with a one-line summary
//   write_learned_skill   — create or fully overwrite a learned skill
//   append_learned_skill  — append new findings to an existing skill
//   search_learned_skills — fuzzy search across skill names and content
//   delete_learned_skill  — remove an outdated or superseded skill

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import type { ToolDefinition } from "./types/types.js";
import { fuzzyScore } from "./utils/fuzzy.js";

const LEARNED_SKILLS_DIR = () =>
  path.join(os.homedir(), ".cypherclaw", "learned-skills");

function skillPath(name: string): string {
  const dir = LEARNED_SKILLS_DIR();
  const resolved = path.resolve(dir, name.endsWith(".md") ? name : `${name}.md`);
  if (!resolved.startsWith(dir + path.sep) && resolved !== dir) {
    throw new Error(`"${name}" resolves outside the learned-skills directory.`);
  }
  return resolved;
}

interface LearnedSkillFrontmatter {
  name?: string;
  description?: string;
}

function parseFrontmatter(content: string): LearnedSkillFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    return (yaml.load(match[1]) as LearnedSkillFrontmatter) ?? {};
  } catch {
    return {};
  }
}

function extractSummary(content: string): string {
  const fm = parseFrontmatter(content);
  if (fm.description) return fm.description.trim().split("\n")[0];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line === "---") continue;
    return line.startsWith("#") ? line.replace(/^#+\s*/, "") : line;
  }
  return "(no summary)";
}

async function listSkillFiles(): Promise<string[]> {
  const dir = LEARNED_SKILLS_DIR();
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// list_learned_skills
// ---------------------------------------------------------------------------

export const listLearnedSkillsTool: ToolDefinition = {
  name: "list_learned_skills",
  description:
    "List all learned skills — techniques and solutions the agent has recorded from past tasks. " +
    "Returns each skill's name and a one-line summary extracted from its content. " +
    "Call this at the start of a task to check for relevant prior knowledge, " +
    "then use search_learned_skills or read_file to load the full content.",

  parameters: {
    type: "object",
    properties: {},
    required: [],
  },

  async execute(): Promise<string> {
    process.stderr.write(`\x1b[36m[list_learned_skills]\x1b[0m ${LEARNED_SKILLS_DIR()}\n`);

    const files = await listSkillFiles();
    if (files.length === 0) return "(no learned skills yet)";

    const lines: string[] = [];
    for (const file of files) {
      const filePath = path.join(LEARNED_SKILLS_DIR(), file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const fm = parseFrontmatter(content);
        const displayName = fm.name ?? file.replace(/\.md$/, "");
        const summary = extractSummary(content);
        lines.push(`${displayName} — ${summary}`);
      } catch {
        lines.push(`${file.replace(/\.md$/, "")} — (unreadable)`);
      }
    }

    return lines.join("\n");
  },
};

// ---------------------------------------------------------------------------
// write_learned_skill
// ---------------------------------------------------------------------------

export const writeLearnedSkillTool: ToolDefinition = {
  name: "write_learned_skill",
  description:
    "Create or fully overwrite a learned skill — a Markdown document recording a technique, " +
    "pattern, or solution discovered during a task. " +
    "Use a short, descriptive kebab-case name (e.g. \"deploy-with-docker\", \"parse-jwt-tokens\"). " +
    "Content MUST follow the AgentSkills format: start with a YAML frontmatter block containing " +
    "at minimum 'name' (display name) and 'description' (one-line summary), followed by the full " +
    "Markdown body. Example:\n" +
    "---\nname: Deploy with Docker\ndescription: How to build and run a service as a Docker container.\n---\n\n# Deploy with Docker\n...\n\n" +
    "Call this after completing a non-trivial task if the approach is worth reusing. " +
    "Use append_learned_skill to add new findings without replacing existing content.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Skill identifier — short kebab-case name without extension (e.g. \"fix-cors-errors\"). " +
          "This becomes the filename.",
      },
      content: {
        type: "string",
        description:
          "Full Markdown content of the skill. Start with a # heading. " +
          "Include what the skill covers, when to use it, and step-by-step details.",
      },
    },
    required: ["name", "content"],
  },

  async execute(args): Promise<string> {
    const name = (args["name"] as string).trim();
    const content = args["content"] as string;

    if (!name) return "Error: name must not be empty.";

    let filePath: string;
    try {
      filePath = skillPath(name);
    } catch (err: unknown) {
      return `Error: ${(err as Error).message}`;
    }

    process.stderr.write(`\x1b[36m[write_learned_skill]\x1b[0m ${filePath}\n`);

    try {
      await fs.mkdir(LEARNED_SKILLS_DIR(), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return `Learned skill saved: ${name}`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error writing learned skill: ${error.message ?? String(err)}`;
    }
  },
};

// ---------------------------------------------------------------------------
// append_learned_skill
// ---------------------------------------------------------------------------

export const appendLearnedSkillTool: ToolDefinition = {
  name: "append_learned_skill",
  description:
    "Append new findings or updates to an existing learned skill without replacing its content. " +
    "Use this when you discover an edge case, correction, or additional technique that extends " +
    "a skill you've already written. " +
    "Use write_learned_skill if you need to restructure or fully replace the skill.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill identifier to append to (same name used when writing it).",
      },
      content: {
        type: "string",
        description: "Markdown content to append at the end of the skill file.",
      },
    },
    required: ["name", "content"],
  },

  async execute(args): Promise<string> {
    const name = (args["name"] as string).trim();
    const content = args["content"] as string;

    if (!name) return "Error: name must not be empty.";

    let filePath: string;
    try {
      filePath = skillPath(name);
    } catch (err: unknown) {
      return `Error: ${(err as Error).message}`;
    }

    process.stderr.write(`\x1b[36m[append_learned_skill]\x1b[0m ${filePath}\n`);

    try {
      await fs.mkdir(LEARNED_SKILLS_DIR(), { recursive: true });
      await fs.appendFile(filePath, content, "utf-8");
      return `Appended ${content.length} characters to learned skill: ${name}`;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return `Error appending to learned skill: ${error.message ?? String(err)}`;
    }
  },
};

// ---------------------------------------------------------------------------
// search_learned_skills
// ---------------------------------------------------------------------------

const SEARCH_THRESHOLD = 0.2;
const MAX_RESULTS = 10;
const SNIPPET_CONTEXT_CHARS = 120;

export const searchLearnedSkillsTool: ToolDefinition = {
  name: "search_learned_skills",
  description:
    "Fuzzy search across learned skill names and content to find relevant prior knowledge. " +
    "Matches against both filenames and line-by-line content, returning ranked results with snippets. " +
    "Use this before starting a task to check if you've solved something similar before.",

  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query, matched against skill names and content.",
      },
    },
    required: ["query"],
  },

  async execute(args): Promise<string> {
    const query = (args["query"] as string).trim();
    if (!query) return "Error: query must not be empty.";

    process.stderr.write(`\x1b[36m[search_learned_skills]\x1b[0m ${query}\n`);

    const files = await listSkillFiles();
    if (files.length === 0) return "(no learned skills yet)";

    type Hit = { name: string; score: number; snippet?: string; line?: number };
    const hits: Hit[] = [];

    for (const file of files) {
      const name = file.replace(/\.md$/, "");
      const filePath = path.join(LEARNED_SKILLS_DIR(), file);

      const nameScore = fuzzyScore(query, name);
      if (nameScore >= SEARCH_THRESHOLD) {
        hits.push({ name, score: nameScore });
        continue;
      }

      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      let bestScore = 0;
      let bestSnippet: string | undefined;
      let bestLine: number | undefined;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const score = fuzzyScore(query, line);
        if (score >= SEARCH_THRESHOLD && score > bestScore) {
          bestScore = score;
          bestSnippet =
            line.length > SNIPPET_CONTEXT_CHARS
              ? line.slice(0, SNIPPET_CONTEXT_CHARS) + "…"
              : line;
          bestLine = i + 1;
        }
      }

      if (bestScore >= SEARCH_THRESHOLD) {
        hits.push({ name, score: bestScore, snippet: bestSnippet, line: bestLine });
      }
    }

    if (hits.length === 0) return `No learned skills matched "${query}".`;

    const ranked = hits
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);

    const lines: string[] = [];
    for (const hit of ranked) {
      const loc = hit.line !== undefined ? `:${hit.line}` : "";
      const snippet = hit.snippet ? `\n    ${hit.snippet}` : "";
      lines.push(`${hit.name}${loc} (score ${hit.score.toFixed(2)})${snippet}`);
    }

    return lines.join("\n");
  },
};

// ---------------------------------------------------------------------------
// delete_learned_skill
// ---------------------------------------------------------------------------

export const deleteLearnedSkillTool: ToolDefinition = {
  name: "delete_learned_skill",
  description:
    "Delete a learned skill that is no longer accurate, has been superseded, or is no longer relevant. " +
    "Use write_learned_skill or append_learned_skill to update a skill rather than deleting and rewriting.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill identifier to delete (as shown by list_learned_skills).",
      },
    },
    required: ["name"],
  },

  async execute(args): Promise<string> {
    const name = (args["name"] as string).trim();
    if (!name) return "Error: name must not be empty.";

    let filePath: string;
    try {
      filePath = skillPath(name);
    } catch (err: unknown) {
      return `Error: ${(err as Error).message}`;
    }

    process.stderr.write(`\x1b[36m[delete_learned_skill]\x1b[0m ${filePath}\n`);

    try {
      await fs.unlink(filePath);
      return `Deleted learned skill: ${name}`;
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === "ENOENT") {
        return `Error: learned skill not found: "${name}". Use list_learned_skills to see available skills.`;
      }
      return `Error deleting learned skill: ${error.message ?? String(err)}`;
    }
  },
};
