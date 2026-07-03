---
name: cli
description: Build and extend the `rag` CLI (GO-21h) — a TypeScript commander program with `ingest <path>` and `query <question>` subcommands that reuse the NestJS services in-process (no HTTP). Use when implementing GO-21h, adding a CLI subcommand, or when the user says "rag command", "CLI wrapper", "npx rag". Encodes the app-context reuse pattern so the CLI never duplicates pipeline logic or shells out to the API.
---

# cli

A terminal front-end over the same services the API uses — one pipeline, two entrypoints.

## Non-negotiables (GO-21h + rules)

- **No HTTP.** The CLI must not call `POST /ingest`/`POST /query` — it bootstraps the app context and calls services in-process, the same pattern as `eval/run-eval.ts`:
  `NestFactory.createApplicationContext(AppModule, { logger: false })` → `app.get(IngestionService)` / `app.get(GenerationService)`.
- **No logic duplication.** If the CLI needs behaviour a service doesn't expose, extend the service — never re-implement chunking/retrieval/generation in CLI code (rule `coding-standards.md`).
- Config via env exactly like the API (`DATABASE_URL`, API keys, `RETRIEVAL_K`, …). Never prompt for or print a secret.

## Layout

- Code lives in **`src/cli/`** (e.g. `src/cli/main.ts`), so the root tsconfig, the typecheck hook, `nest build`, and Jest cover it with zero extra config.
- `package.json`: `"bin": { "rag": "dist/cli/main.js" }`; first line of `src/cli/main.ts` is `#!/usr/bin/env node`.
- Arg parsing: `commander` (a runtime dep — sanctioned by GO-21h).

## Subcommands (the done-when)

- `rag ingest <path>` → `IngestionService.ingest(path)` → print stats (docs, chunks, ms).
- `rag query <question>` → `GenerationService.generate(question)` → print the answer, then citations (source + cited text); the abstain answer passes through verbatim — don't mask it.
- Non-zero exit on failure; answer/citations to stdout, errors to stderr.

## Checklist

1. Build (`npm run build`), then smoke it live: `node dist/cli/main.js query "..."` against the running stack.
2. Unit-test the output formatting; service behaviour is already covered by the service specs.
3. Update `doc/codemap.md` (new files, symbols, bin entry) and append the slice's learnings to `doc/LEARNINGS.md`.
