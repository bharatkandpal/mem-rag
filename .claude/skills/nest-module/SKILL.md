---
name: nest-module
description: Scaffold a new NestJS feature module (module + service + optional controller) following this project's conventions. Use when adding a module — ingestion, retrieval, generation, eval — or any new concern (TDD §2.6). Keeps structure consistent: thin controllers, injectable services, adapter seams, config via ConfigService, structured logging, a unit test, and a codemap update.
---

# nest-module

Add a feature module the same way every time, so the codebase stays legible as it grows.

## Layout (one folder per concern under `src/`)

```
src/<concern>/
  <concern>.module.ts      # wires providers + controllers; imports what it needs
  <concern>.service.ts     # the logic — injectable, testable
  <concern>.controller.ts  # only if it exposes HTTP; thin — delegates to the service
  <concern>.service.spec.ts
```

Then register the module in `src/app.module.ts`.

## Rules to honour (from `.claude/rules/`)

- **No logic in controllers.** Controllers parse/validate input and call the service. Period.
- **Go through adapter interfaces** for anything touching embeddings or the vector store (`EmbeddingProvider`, `VectorStore`) — never call Voyage or pgvector directly (rule `coding-standards.md`).
- **Config via `ConfigService`** — no magic constants for `k`, model IDs, endpoints.
- **Structured logging** on the hot paths (Nest `Logger`/pino) — never `console.log`.
- **Secrets via env only** (rule `ai-and-secrets.md`).

## Checklist

1. Create the folder + files above; keep the service the single place logic lives.
2. Inject dependencies (`PG_POOL`, adapters, `ConfigService`) via the constructor.
3. Register in `AppModule`.
4. Add a unit test for the service's core behaviour.
5. **Update `doc/codemap.md`** (codemap skill) — new files, symbols, routes, and usages. Not optional (rule `coding-standards.md`).

## Guardrails

If the module touches retrieval, a passing build isn't enough — run `run-evals` and report the number (rule `evals.md`).
