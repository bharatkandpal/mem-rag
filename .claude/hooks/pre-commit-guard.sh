#!/usr/bin/env bash
# PreToolUse(Bash) hook: gates `git commit` on the two binding rules.
#   coding-standards.md — TS changes under src/ or eval/ ship with a doc/codemap.md update.
#   evals.md           — retrieval-affecting changes state before/after eval numbers.
# Exit 2 blocks the commit with guidance; everything else passes silently.
# Escape hatches (put in the commit message): [codemap-ok] / [eval-ok].
set -uo pipefail

input=$(cat 2>/dev/null || true)
case "$input" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

staged=$(git diff --cached --name-only 2>/dev/null || true)
[ -n "$staged" ] || exit 0

# Gate 1: code changed but the codemap didn't (spec files aren't indexed there).
code_staged=$(printf '%s\n' "$staged" | grep -E '^(src|eval)/.*\.ts$' | grep -v '\.spec\.ts$' || true)
if [ -n "$code_staged" ] && ! printf '%s\n' "$staged" | grep -qx 'doc/codemap.md'; then
  case "$input" in
    *codemap-ok*) ;;
    *)
      echo "Commit blocked (rule coding-standards.md): staged TS changes without a doc/codemap.md update:" >&2
      printf '%s\n' "$code_staged" >&2
      echo "Update and stage doc/codemap.md (codemap skill / codemap-updater agent). If no exported symbol, signature, route, or env var changed, add [codemap-ok] to the commit message instead." >&2
      exit 2
      ;;
  esac
fi

# Gate 2: retrieval-affecting files staged but no eval evidence in the message.
# Evidence = the word "eval" (not the substring in "retrieval"), hit-rate, or precision.
retrieval_staged=$(printf '%s\n' "$staged" | grep -E '^(src/ingestion/(chunker|tokenizer)\.ts|src/(retrieval|vector-store|embedding)/[^/]+\.ts|db/migrations/.*\.sql)$' | grep -v '\.spec\.ts$' || true)
if [ -n "$retrieval_staged" ] && ! printf '%s' "$input" | grep -qiE '(^|[^[:alpha:]])eval|hit-?rate|precision'; then
  echo "Commit blocked (rule evals.md): retrieval-affecting files staged with no eval evidence in the commit message:" >&2
  printf '%s\n' "$retrieval_staged" >&2
  echo "Run npm run eval and state before -> after in the commit message body. If the change cannot affect retrieval quality, add [eval-ok]." >&2
  exit 2
fi

exit 0
