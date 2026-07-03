---
name: git-ops
description: Safe, consistent git and GitHub operations for this repo — staging, committing, branching, PRs. Use whenever the user wants to commit, push, branch, open a PR, check status/log, or otherwise touch git/GitHub. Encodes the repo's conventions so every commit looks the same and nothing destructive happens by surprise.
---

# git-ops

Make git operations predictable and safe. Follow these rules exactly — they exist so history stays clean and irreversible actions never happen unprompted.

## When to act vs. ask

- **Commit or push only when the user asks.** Don't auto-commit after edits.
- **Branching:** on an established repo, if you're on the default branch (`main`/`master`), create a feature branch before committing work. **Exception:** the very first commit of a brand-new repo goes on the default branch — that's expected.
- **Never** force-push, hard-reset, rewrite published history, or delete branches unless the user explicitly asks and confirms.
- Interactive flags (`-i`) aren't supported here — don't use `git rebase -i` / `git add -i`.

## Commit workflow

1. `git status` + `git diff --staged` (or stage first, then review) — know exactly what's going in.
2. Stage intentionally (`git add <paths>`); avoid blind `git add -A` if unrelated changes are floating. For the initial scaffold commit, `-A` is fine.
3. Group related changes into one logical commit. Don't bundle unrelated work.
4. **Message format** — Conventional Commits subject, imperative mood, ≤72 chars; body explains *why* when non-obvious. **No `Co-Authored-By` / attribution trailer** — this repo's commits carry no AI attribution (enforced via `attribution.commit: ""` in `.claude/settings.json`, so it holds regardless of harness defaults).
   Examples: `feat(retrieval): add min-score floor`, `chore: scaffold rag project`, `fix(ingest): dedupe on re-run`.
5. Verify: `git log --oneline -1` to confirm it landed.

## GitHub

- Use the `gh` CLI for anything GitHub (PRs, issues, remotes). End PR bodies with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Pushing and opening a PR are outward-facing — confirm with the user first unless told to proceed.

## Project-specific

- `.env` and secrets must never be staged (the `.gitignore` covers them — but double-check `git status` before a commit that touches config; see rule `ai-and-secrets.md`).
- Keep commit history clean — contributors and integrators read it; it's part of the product's quality bar (PRD §5).
- A PreToolUse hook guards `git commit`: staged TS changes under `src/`/`eval/` need `doc/codemap.md` staged too, and retrieval-affecting changes need eval evidence in the message. It says exactly what's missing; `[codemap-ok]` / `[eval-ok]` in the message acknowledge genuine no-ops (rules `coding-standards.md` / `evals.md`).

## On agents

No git subagent is needed: git operations are deterministic, fast, and run inline. Spawning an agent would add cost and indirection for no benefit. If a large, parallelizable history-rewrite ever comes up, reconsider — but the default is inline.
