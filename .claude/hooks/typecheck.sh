#!/usr/bin/env bash
# PostToolUse hook: typecheck after edits, once the project actually exists.
# Guarded so it's a silent no-op pre-scaffold (before package.json / deps exist).
set -euo pipefail
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

# No project yet, or deps not installed → nothing to check.
[ -f package.json ] || exit 0
[ -f tsconfig.json ] || exit 0
[ -d node_modules ] || exit 0

# Typecheck only; stay quiet on success, surface errors to the agent.
if ! out=$(npx --no-install tsc --noEmit 2>&1); then
  echo "TypeScript errors after edit:" >&2
  echo "$out" >&2
  exit 2   # non-zero with stderr feeds the message back to Claude
fi
exit 0
