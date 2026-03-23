#!/usr/bin/env bash
# setup.sh — Interactive setup wizard for CypherClaw.
# Creates / updates .env with provider, model, API key, and optional tool keys.
# Pure bash — no Node.js or npm required.

set -euo pipefail

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

# ── Helpers ──────────────────────────────────────────────────────────────────

bold()  { printf '\033[1m%s\033[0m' "$*"; }
green() { printf '\033[32m%s\033[0m' "$*"; }
dim()   { printf '\033[2m%s\033[0m' "$*"; }

# Read a value from the existing .env (returns empty string if not found).
env_get() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]]; then
    grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | sed "s/^${key}=//"
  fi
}

# Set a key=value in .env. Updates in place if it exists (even if commented),
# otherwise appends.
env_set() {
  local key="$1" value="$2"
  local line="${key}=${value}"
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "$line" > "$ENV_FILE"
    return
  fi
  if grep -qE "^#?\s*${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^#\?\s*${key}=.*|${line}|" "$ENV_FILE"
  else
    echo "$line" >> "$ENV_FILE"
  fi
}

# Mask an API key for display: show prefix + last 4 chars.
mask_key() {
  local key="$1"
  local len=${#key}
  if (( len <= 8 )); then
    echo "****"
  else
    echo "${key:0:4}...${key: -4}"
  fi
}

# Prompt with a default value. Empty input accepts the default.
prompt_default() {
  local prompt="$1" default="$2" result
  if [[ -n "$default" ]]; then
    read -rp "  $prompt [$(dim "$default")]: " result
    echo "${result:-$default}"
  else
    read -rp "  $prompt: " result
    echo "$result"
  fi
}

# Prompt for a secret (hidden input).
prompt_secret() {
  local prompt="$1" default="$2" result
  if [[ -n "$default" ]]; then
    read -rsp "  $prompt [$(dim "$(mask_key "$default")")]: " result
    echo
    echo "${result:-$default}"
  else
    read -rsp "  $prompt: " result
    echo
    echo "$result"
  fi
}

# ── Banner ───────────────────────────────────────────────────────────────────

echo
echo "  $(bold 'CypherClaw Setup')"
echo "  ─────────────────"
echo

# ── Seed .env from .env.example if it doesn't exist ─────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "  $(green '✓') Created .env from .env.example"
  else
    touch "$ENV_FILE"
    echo "  $(green '✓') Created empty .env"
  fi
  echo
fi

# ── Step 1: Provider ────────────────────────────────────────────────────────

PROVIDERS=("openai" "anthropic" "openrouter")
CURRENT_PROVIDER="$(env_get CYPHERCLAW_PROVIDER)"

echo "  $(bold '[1/3] Choose your AI provider')"
for i in "${!PROVIDERS[@]}"; do
  label="${PROVIDERS[$i]}"
  if [[ "$label" == "$CURRENT_PROVIDER" ]]; then
    echo "    $((i+1))) $label $(dim '(current)')"
  else
    echo "    $((i+1))) $label"
  fi
done
echo

PROVIDER=""
while [[ -z "$PROVIDER" ]]; do
  choice="$(prompt_default "Provider" "${CURRENT_PROVIDER:-1}")"
  # Accept number or name
  if [[ "$choice" =~ ^[1-3]$ ]]; then
    PROVIDER="${PROVIDERS[$((choice-1))]}"
  else
    for p in "${PROVIDERS[@]}"; do
      if [[ "$p" == "$choice" ]]; then
        PROVIDER="$p"
        break
      fi
    done
  fi
  if [[ -z "$PROVIDER" ]]; then
    echo "    Please enter 1-3 or a provider name."
  fi
done
echo

# ── Step 2: Model ───────────────────────────────────────────────────────────

declare -A MODEL_OPTIONS
MODEL_OPTIONS[openai]="gpt-4o|gpt-4o-mini|gpt-4.1|gpt-4.1-mini"
MODEL_OPTIONS[anthropic]="claude-sonnet-4-6|claude-opus-4-6|claude-haiku-4-5"
MODEL_OPTIONS[openrouter]="openai/gpt-4o|anthropic/claude-sonnet-4-6|google/gemini-2.5-pro"

declare -A DEFAULT_MODEL
DEFAULT_MODEL[openai]="gpt-4o-mini"
DEFAULT_MODEL[anthropic]="claude-sonnet-4-6"
DEFAULT_MODEL[openrouter]="openai/gpt-4o"

CURRENT_MODEL="$(env_get CYPHERCLAW_MODEL)"
IFS='|' read -ra MODELS <<< "${MODEL_OPTIONS[$PROVIDER]}"

echo "  $(bold '[2/3] Choose a model')"
for i in "${!MODELS[@]}"; do
  label="${MODELS[$i]}"
  marker=""
  if [[ "$label" == "$CURRENT_MODEL" ]]; then
    marker=" $(dim '(current)')"
  elif [[ "$label" == "${DEFAULT_MODEL[$PROVIDER]}" && -z "$CURRENT_MODEL" ]]; then
    marker=" $(dim '(default)')"
  fi
  echo "    $((i+1))) ${label}${marker}"
done
echo "    $((${#MODELS[@]}+1))) Custom"
echo

model_choice="$(prompt_default "Model" "${CURRENT_MODEL:-${DEFAULT_MODEL[$PROVIDER]}}")"
# Accept number or name
if [[ "$model_choice" =~ ^[0-9]+$ ]]; then
  idx=$((model_choice-1))
  if (( idx >= 0 && idx < ${#MODELS[@]} )); then
    MODEL="${MODELS[$idx]}"
  elif (( idx == ${#MODELS[@]} )); then
    MODEL="$(prompt_default "Enter model name" "")"
  else
    MODEL="$model_choice"
  fi
else
  MODEL="$model_choice"
fi
echo

# ── Step 3: API key ─────────────────────────────────────────────────────────

declare -A KEY_VARS
KEY_VARS[openai]="OPENAI_API_KEY"
KEY_VARS[anthropic]="ANTHROPIC_API_KEY"
KEY_VARS[openrouter]="OPENROUTER_API_KEY"

KEY_VAR="${KEY_VARS[$PROVIDER]}"
CURRENT_KEY="$(env_get "$KEY_VAR")"

# Check if the current key is just a placeholder from .env.example
if [[ "$CURRENT_KEY" == "sk-..." || "$CURRENT_KEY" == "sk-ant-..." || "$CURRENT_KEY" == "sk-or-..." ]]; then
  CURRENT_KEY=""
fi

# Also check the shell environment for an existing key
if [[ -z "$CURRENT_KEY" && -n "${!KEY_VAR:-}" ]]; then
  CURRENT_KEY="${!KEY_VAR}"
  echo "  $(dim "Found ${KEY_VAR} in your environment")"
fi

echo "  $(bold '[3/3] Enter your API key')"
API_KEY=""
while [[ -z "$API_KEY" ]]; do
  API_KEY="$(prompt_secret "$KEY_VAR" "$CURRENT_KEY")"
  if [[ -z "$API_KEY" ]]; then
    echo "    API key cannot be empty."
  fi
done
echo

# ── Write core config ───────────────────────────────────────────────────────

env_set "CYPHERCLAW_PROVIDER" "$PROVIDER"
env_set "CYPHERCLAW_MODEL" "$MODEL"
env_set "$KEY_VAR" "$API_KEY"

echo "  $(green '✓') Saved to .env"
echo "    CYPHERCLAW_PROVIDER=$PROVIDER"
echo "    CYPHERCLAW_MODEL=$MODEL"
echo "    ${KEY_VAR}=$(mask_key "$API_KEY")"
echo

# ── Optional integrations ───────────────────────────────────────────────────

read -rp "  Configure optional tool integrations? [y/N]: " do_extras
echo

if [[ "$do_extras" =~ ^[Yy]$ ]]; then

  echo "  $(bold 'Web Fetch & Search')"
  echo "  $(dim 'Press Enter to skip any key.')"
  echo

  # Jina
  current="$(env_get JINA_API_KEY)"
  if [[ "$current" == "jina_..." ]]; then current=""; fi
  val="$(prompt_secret "Jina API key (free — jina.ai/reader)" "$current")"
  if [[ -n "$val" ]]; then env_set "JINA_API_KEY" "$val"; fi

  # Firecrawl
  current="$(env_get FIRECRAWL_API_KEY)"
  if [[ "$current" == "fc-..." ]]; then current=""; fi
  val="$(prompt_secret "Firecrawl API key (paid — firecrawl.dev)" "$current")"
  if [[ -n "$val" ]]; then env_set "FIRECRAWL_API_KEY" "$val"; fi

  echo
  echo "  $(bold 'Search Providers')"
  echo

  # Brave
  current="$(env_get BRAVE_API_KEY)"
  if [[ "$current" == "BSA..." ]]; then current=""; fi
  val="$(prompt_secret "Brave Search API key (brave.com/search/api)" "$current")"
  if [[ -n "$val" ]]; then env_set "BRAVE_API_KEY" "$val"; fi

  # Tavily
  current="$(env_get TAVILY_API_KEY)"
  if [[ "$current" == "tvly-..." ]]; then current=""; fi
  val="$(prompt_secret "Tavily API key (tavily.com)" "$current")"
  if [[ -n "$val" ]]; then env_set "TAVILY_API_KEY" "$val"; fi

  # Exa
  current="$(env_get EXA_API_KEY)"
  val="$(prompt_secret "Exa API key (exa.ai)" "$current")"
  if [[ -n "$val" ]]; then env_set "EXA_API_KEY" "$val"; fi

  # Marginalia
  current="$(env_get MARGINALIA_API_KEY)"
  val="$(prompt_secret "Marginalia API key (free — email for dedicated key)" "$current")"
  if [[ -n "$val" ]]; then env_set "MARGINALIA_API_KEY" "$val"; fi

  echo
  echo "  $(bold 'Email')"
  echo

  # Mailhook
  current="$(env_get MAILHOOK_API_KEY)"
  val="$(prompt_secret "Mailhook API key (mailhook.co)" "$current")"
  if [[ -n "$val" ]]; then env_set "MAILHOOK_API_KEY" "$val"; fi

  echo
  echo "  $(green '✓') Optional integrations saved"
  echo
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo "  $(green '✓') Setup complete!"
echo "    Run $(bold 'npm install && npm run chat') to get started."
echo
