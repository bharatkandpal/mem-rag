---
name: codemap
description: Build and maintain doc/codemap.md — the index of files → exported symbols → where each is used. Use whenever code is added, changed, or deleted (new function/class/module/route, renamed or removed symbol, changed signature), or when the user asks to "update the codemap" / "refresh the code map". The codemap is the impact-analysis tool: before changing a function, you look it up to see every affected file. Keep it accurate after every code change.
---

# codemap

Maintain `doc/codemap.md` so it always answers one question: **"if I change this symbol, what else is affected?"** A stale codemap is worse than none — update it as part of finishing any code change.

## When to run

- After adding/editing/deleting any `src/**` or `eval/**` symbol (function, class, module, interface, const, route) — and any future `cli/**` code. Anything TypeScript outside `node_modules` is in scope.
- After a rename or signature change (these ripple through "Used in").
- On request ("update the codemap").

## What the codemap must contain

1. **Files** — one entry per `src`/`eval` code file: purpose, the symbols it defines/exports, what it depends on, and what uses it.
2. **Symbol → usage index** — the table that matters most: every exported symbol, where it's defined, and **every file that uses it**.
3. **HTTP routes** — method · path · handler · file.
4. **Env vars → read in** — which file reads each (mark reserved ones not yet wired).
5. **Non-code assets** — SQL/init/compose files and what consumes them.
6. **Last updated** — the milestone or commit it reflects.

## How to update (prefer incremental)

1. Identify what changed (the files you just edited, or `git diff --name-only`).
2. For each changed symbol, find its real usages: `grep -rn "<symbolName>" src/ eval/` (don't trust memory — verify call sites).
3. Update that file's entry **and** every row of the Symbol→usage index the change touches (a rename updates both the "Defined in" and all "Used in"; a deletion removes the row and its references).
4. Update routes / env / assets tables if those changed.
5. Bump the **Last updated** line.

Full rebuilds (scan `src/` + `eval/`) are fine for big refactors; incremental is the default to stay fast.

## Dispatching

For anything beyond a trivial one-symbol edit, dispatch the **`codemap-updater`** agent with the list of changed files — it does the grep-verified usage pass and edits `doc/codemap.md` so the main thread stays focused.

## Guardrails

- **Verify usages by grep, never by recall** — the whole point is accuracy.
- Don't let the index drift: if `git diff` touched `src/` or `eval/` but `doc/codemap.md` didn't, the change isn't done (the pre-commit guard enforces this).
- Keep entries terse — purpose in one line, symbols as a list. This is a lookup table, not prose.
