#!/usr/bin/env bash
# PostToolUse hook: typecheck after TypeScript edits, once the project actually exists.
# Guarded so it's a silent no-op pre-scaffold (before package.json / deps exist).
set -euo pipefail

# Only TS edits need a typecheck; skip doc/config-only edits.
# (Empty/unparseable stdin falls through to a full typecheck — safe default.)
input=$(cat 2>/dev/null || true)
if [ -n "$input" ] && ! printf '%s' "$input" | grep -qE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*\.tsx?"'; then
  exit 0
fi

# Hooks run in a non-login shell; source nvm so node/npx are on PATH.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" --no-use
[ -s "$NVM_DIR/alias/default" ] && nvm use default --silent 2>/dev/null || true

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

# No project yet, or deps not installed → nothing to check.
[ -f package.json ] || exit 0
[ -f tsconfig.json ] || exit 0
[ -d node_modules ] || exit 0

# tsconfig.eval.json is a superset (src/ + eval/); the root tsconfig covers src/ only.
cfg="tsconfig.json"
[ -f tsconfig.eval.json ] && cfg="tsconfig.eval.json"

# Typecheck only; stay quiet on success, surface errors to the agent.
if ! out=$(npx --no-install tsc --noEmit -p "$cfg" 2>&1); then
  echo "TypeScript errors after edit:" >&2
  echo "$out" >&2
  exit 2   # non-zero with stderr feeds the message back to Claude
fi
exit 0
