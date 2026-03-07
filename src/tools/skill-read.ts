// tools/skill-read.ts
// -------------------
// Provides access to AgentSkills-format skills bundled with CypherClaw.
//
// Two tools are exported:
//   list_skills — lists all available skills with their name and description,
//                 parsed from each skill's SKILL.md frontmatter. Paginated.
//   read_skill  — reads a skill's SKILL.md and returns a manifest of any
//                 additional files (scripts/, references/, assets/, etc.) so
//                 the agent can load them on demand with read_file.
//
// Skills live in src/skills/ (or dist/skills/ when built). Each skill is a
// directory containing at minimum a SKILL.md file, as per the AgentSkills spec.
// Path is resolved relative to this file via import.meta.url so it works in
// both dev (tsx) and production (node dist/).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { ToolDefinition } from "./types/types.js";
import { fuzzyScore } from "./utils/fuzzy.js";

const SKILLS_DIR = path.resolve(fileURLToPath(import.meta.url), "../../skills");
const PAGE_SIZE = 200;

interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  "allowed-tools"?: string;
}

function parseFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    return (yaml.load(match[1]) as SkillFrontmatter) ?? {};
  } catch {
    return {};
  }
}

async function listSkillDirs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    const withSkillMd: string[] = [];
    for (const dir of dirs) {
      try {
        await fs.access(path.join(SKILLS_DIR, dir, "SKILL.md"));
        withSkillMd.push(dir);
      } catch {
        // no SKILL.md — skip
      }
    }
    return withSkillMd;
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    throw err;
  }
}

async function walkDir(dir: string, base: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      results.push(...(await walkDir(full, base)));
    } else {
      results.push(rel);
    }
  }
  return results;
}

export const listSkillsTool: ToolDefinition = {
  name: "list_skills",
  description:
    "List all AgentSkills-format skills available in CypherClaw. " +
    "Returns each skill's name and description, parsed from its SKILL.md frontmatter. " +
    `Results are paginated (${PAGE_SIZE} per page) — use the page parameter to fetch further pages. ` +
    "Call this when a user request might benefit from a skill, then use read_skill to load the full instructions.",

  parameters: {
    type: "object",
    properties: {
      page: {
        type: "number",
        description: `Page number to retrieve (1-based, ${PAGE_SIZE} skills per page). Defaults to 1.`,
      },
    },
    required: [],
  },

  async execute(args): Promise<string> {
    const page = Math.max(1, Math.floor((args["page"] as number | undefined) ?? 1));
    const offset = (page - 1) * PAGE_SIZE;

    process.stderr.write(`\x1b[33m[list_skills]\x1b[0m page=${page}\n`);

    const dirs = await listSkillDirs();

    if (dirs.length === 0) {
      return "(no skills available)";
    }

    const totalPages = Math.ceil(dirs.length / PAGE_SIZE);
    const slice = dirs.slice(offset, offset + PAGE_SIZE);

    if (slice.length === 0) {
      return `Page ${page} is out of range. Total pages: ${totalPages}.`;
    }

    const lines: string[] = [];
    for (const dir of slice) {
      const skillMdPath = path.join(SKILLS_DIR, dir, "SKILL.md");
      try {
        const content = await fs.readFile(skillMdPath, "utf-8");
        const fm = parseFrontmatter(content);
        const name = fm.name ?? dir;
        const desc = fm.description ?? "(no description)";
        lines.push(`${name} — ${desc}`);
      } catch {
        lines.push(`${dir} — (unreadable SKILL.md)`);
      }
    }

    const footer =
      totalPages > 1
        ? `\n\nPage ${page} of ${totalPages} (${dirs.length} total skills).`
        : "";

    return lines.join("\n") + footer;
  },
};

const SEARCH_THRESHOLD = 0.2;
const MAX_SEARCH_RESULTS = 10;

export const searchSkillTool: ToolDefinition = {
  name: "search_skill",
  description:
    "Fuzzy search for skills by name. " +
    "Use this when you have a partial or approximate skill name and want to find the closest match. " +
    "Returns matching skill names ranked by similarity, with their descriptions. " +
    "Then use read_skill to load the full instructions for the skill you want.",

  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query, fuzzy-matched against skill names (directory names).",
      },
    },
    required: ["query"],
  },

  async execute(args): Promise<string> {
    const query = (args["query"] as string).trim();
    if (!query) return "Error: query must not be empty.";

    process.stderr.write(`\x1b[33m[search_skill]\x1b[0m ${query}\n`);

    const dirs = await listSkillDirs();
    if (dirs.length === 0) return "(no skills available)";

    const scored = dirs
      .map((dir) => ({ dir, score: fuzzyScore(query, dir) }))
      .filter(({ score }) => score >= SEARCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SEARCH_RESULTS);

    if (scored.length === 0) return `No skills matched "${query}".`;

    const lines: string[] = [];
    for (const { dir, score } of scored) {
      const skillMdPath = path.join(SKILLS_DIR, dir, "SKILL.md");
      try {
        const content = await fs.readFile(skillMdPath, "utf-8");
        const fm = parseFrontmatter(content);
        const desc = fm.description ?? "(no description)";
        lines.push(`${dir} (score ${score.toFixed(2)}) — ${desc}`);
      } catch {
        lines.push(`${dir} (score ${score.toFixed(2)})`);
      }
    }

    return lines.join("\n");
  },
};

export const readSkillTool: ToolDefinition = {
  name: "read_skill",
  description:
    "Read a skill's full instructions from its SKILL.md file. " +
    "Also returns a manifest of any additional files bundled with the skill " +
    "(scripts, references, assets) with their absolute paths — use read_file to load them on demand. " +
    "Use list_skills first to discover available skills and their names.",

  parameters: {
    type: "object",
    properties: {
      skill: {
        type: "string",
        description: 'Skill name (directory name) to read, as returned by list_skills (e.g. "pastebin").',
      },
    },
    required: ["skill"],
  },

  async execute(args): Promise<string> {
    const skill = args["skill"] as string;

    const skillDir = path.resolve(SKILLS_DIR, skill);
    if (!skillDir.startsWith(SKILLS_DIR + path.sep) && skillDir !== SKILLS_DIR) {
      return `Error: "${skill}" resolves outside the skills directory.`;
    }

    process.stderr.write(`\x1b[33m[read_skill]\x1b[0m ${skillDir}\n`);

    const skillMdPath = path.join(skillDir, "SKILL.md");

    let content: string;
    try {
      content = await fs.readFile(skillMdPath, "utf-8");
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === "ENOENT") {
        return `Error: skill not found: "${skill}". Use list_skills to see available skills.`;
      }
      return `Error reading skill: ${error.message ?? String(err)}`;
    }

    let allFiles: string[];
    try {
      allFiles = await walkDir(skillDir, skillDir);
    } catch {
      allFiles = ["SKILL.md"];
    }

    const otherFiles = allFiles.filter((f) => f !== "SKILL.md");

    if (otherFiles.length === 0) {
      return content || "(empty SKILL.md)";
    }

    const manifest = otherFiles
      .map((f) => `  ${path.join(skillDir, f)}`)
      .join("\n");

    return (
      content +
      `\n\n---\nOther files in this skill (load with read_file as needed):\n${manifest}`
    );
  },
};
