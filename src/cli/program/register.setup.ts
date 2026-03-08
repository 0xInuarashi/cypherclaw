// cli/program/register.setup.ts
// ------------------------------
// Registers the `cypherclaw setup` command — an interactive wizard that
// collects the provider, model, and API key, then writes them into .env.
//
// Steps
// -----
//   1. Seed .env from .env.example if .env doesn't exist yet
//   2. Choose an AI provider  (openai | anthropic | openrouter)
//   3. Enter a model name     (defaults to the provider's built-in default)
//   4. Enter the API key for the chosen provider
//
// Only the relevant keys are touched; everything else in .env is left intact.

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";

type ProviderName = "openai" | "anthropic" | "openrouter";

const PROVIDERS: ProviderName[] = ["openai", "anthropic", "openrouter"];

const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  openrouter: "openai/gpt-4o-mini",
};

const API_KEY_VAR: Record<ProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive wizard to configure the AI provider, model, and API key")
    .action(async () => {
      const rl = createInterface({ input, output });

      console.log("\nCypherclaw setup\n");

      // ── Seed .env from .env.example if needed ────────────────────────────
      const envPath = resolve(process.cwd(), ".env");
      if (!existsSync(envPath)) {
        const examplePath = resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../../../.env.example",
        );
        const seed = existsSync(examplePath) ? readFileSync(examplePath, "utf8") : "";
        writeFileSync(envPath, seed, "utf8");
        console.log(".env created from .env.example\n");
      }

      // ── Step 1: provider ─────────────────────────────────────────────────
      console.log("Available providers:");
      PROVIDERS.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
      console.log();

      let provider: ProviderName | undefined;
      while (!provider) {
        const answer = (await rl.question("Choose a provider [1-3]: ")).trim();
        const idx = Number(answer) - 1;
        if (idx >= 0 && idx < PROVIDERS.length) {
          provider = PROVIDERS[idx];
        } else if (PROVIDERS.includes(answer as ProviderName)) {
          provider = answer as ProviderName;
        } else {
          console.log(`  Please enter a number between 1 and ${PROVIDERS.length}, or the provider name.`);
        }
      }

      // ── Step 2: model ────────────────────────────────────────────────────
      const defaultModel = DEFAULT_MODELS[provider];
      const modelAnswer = (
        await rl.question(`Model name [${defaultModel}]: `)
      ).trim();
      const model = modelAnswer || defaultModel;

      // ── Step 3: API key ──────────────────────────────────────────────────
      const keyVar = API_KEY_VAR[provider];
      let apiKey = "";
      while (!apiKey) {
        apiKey = (await rl.question(`${keyVar}: `)).trim();
        if (!apiKey) console.log("  API key cannot be empty.");
      }

      rl.close();

      // ── Write .env ───────────────────────────────────────────────────────
      let content = readFileSync(envPath, "utf8");

      content = setEnvKey(content, "CYPHERCLAW_PROVIDER", provider);
      content = setEnvKey(content, "CYPHERCLAW_MODEL", model);
      content = setEnvKey(content, keyVar, apiKey);

      writeFileSync(envPath, content, "utf8");

      console.log(`\nSaved to ${envPath}`);
      console.log(`  CYPHERCLAW_PROVIDER=${provider}`);
      console.log(`  CYPHERCLAW_MODEL=${model}`);
      console.log(`  ${keyVar}=***`);
      console.log("\nSetup complete.\n");
    });
}

function setEnvKey(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^#?\\s*${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  const trimmed = content.trimEnd();
  return trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
}
