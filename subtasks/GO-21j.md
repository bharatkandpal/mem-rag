# GO-21j / RAG-66 — Embeddable scaffold: `npm run rag init`

> Parent: a `rag init` generator that scaffolds the RAG capability **into a host project** (a
> wired `RagModule` + config), so an integrator embeds RAG rather than just running it. Source:
> `PRD §3` (Integrator persona), `tasks.md` RAG-66. **Shape: scaffolding generator; forks
> settled 2026-07-24.** Approach note to follow:
> [`docs/embeddable-scaffold-guide.md`](../docs/embeddable-scaffold-guide.md).

> 🔗 **Dependency:** the clean DB path (RAG-66e) needs **RAG-46 (migration runner)** — the same
> dep as RAG-64. Everything else is independent of it. RAG-66b onward is code (codemap +
> LEARNINGS apply; **not** retrieval-affecting → `[eval-ok]`, rule `evals.md`).

| ID | Sub-task | Done when | Depends on |
|----|----------|-----------|------------|
| RAG-66a | **Write the approach guide** — two surfaces, the four settled forks, `forRoot` shape, the file set, DoD | `docs/embeddable-scaffold-guide.md` committed and reviewed | — *(done 2026-07-24)* |
| ✅ RAG-66b | **Make the package importable** — `private:false`; add `main`/`types`/`exports`/`files`; `src/index.ts` barrel exporting `RagModule` + `IngestionService`/`RetrievalService`/`GenerationService` + seams/types; `npm pack` clean (no `.env`/fixtures/secrets) | A sibling project can `npm i` (file:/tarball) and `import { RagModule }`; `npm pack` ships `dist` only | RAG-66a — **done 2026-07-29**: barrel + `RagModule.forRoot()` (env-first) + `declaration:true` + `files:['dist']`; `Ingestion`/`Generation` modules now export their service; 115 tests green, pack = 169 files dist+manifest only |
| ✅ RAG-66c | **`RagModule.forRoot(options)` dynamic module** — composes the existing feature modules, re-exports the services; env-first defaults with optional overrides (`embeddingProvider`, `generationProvider`, `k`, `minScore`, `http`) | `RagModule.forRoot({})` boots the full graph from env; an override (e.g. `k`) takes effect; `http:false` omits controllers | RAG-66b — **done 2026-07-29**: `EmbeddingModule`/`GenerationModule`/`IngestionModule`/`RetrievalModule` each gained a `register()` override path; found + fixed a real Nest gotcha along the way (`@Module()` decorator metadata concatenates with, never replaces, a `DynamicModule`'s own `imports`/`controllers` — see `doc/LEARNINGS.md`), which required moving `imports`/`controllers` out of the Generation/Ingestion decorators and routing `AppModule` through the same `register()` calls. 118 tests green, `npm pack` still clean. |
| ✅ RAG-66d | **`rag init` subcommand (scaffold writer)** — third `commander` command in `src/cli/main.ts`; writes the §4 file set into `--target` (cwd default); idempotent (skip-existing, `--force`, `--dry-run`); prints next-steps | Running in an empty dir writes the file set; re-run is safe; `--dry-run` writes nothing | RAG-66c — **done 2026-07-29**: `src/cli/init.ts` (`scaffoldFiles()` + `runInit()`, no app-context bootstrap needed) + `formatInitResult`; writes `src/rag/rag.module.ts`, `.env.rag.example`, `docker-compose.rag.yml`, `db/rag/001_init.sql`. Live-smoke-verified (`node dist/cli/main.js init` + `npx rag init`, re-run skips, `--force` overwrites, `--dry-run` writes nothing, generated compose YAML validates). Bonus find: RAG-46's `migrate.ts` already honors `MIGRATIONS_DIR` env override, so a host can apply `db/rag/001_init.sql` with the shipped runner today — documented in the generated SQL's header, no new runner code needed. 12 new tests, 131 total green. |
| ✅ RAG-66e | **Migration/DB path** — emit `chunks`/HNSW as a migration the host runs (not initdb-only); honor host `DATABASE_URL`; carry the `VECTOR(1024)` dims-trap comment | A scaffolded host applies the schema via the migration runner and ingest works | RAG-66d, **RAG-46** — **done 2026-07-29, live end-to-end**: scaffolded into `/tmp/rag-66e-host`, `docker compose -f docker-compose.rag.yml up -d` (the generated file, for real), applied `db/rag/001_init.sql` via `MIGRATIONS_DIR=db/rag DATABASE_URL=...(port 5433) node dist/database/migrate.js` (the shipped runner, no new code), confirmed idempotent (re-run: "up to date"), then `rag ingest eval/sample-corpus` with `EMBEDDING_PROVIDER=transformers` (key-free) — 4 docs → 9 chunks, cross-checked with a direct `SELECT count(*) FROM chunks` in the container. Torn down clean (`docker compose down -v`). |
| ✅ RAG-66f | **`npm run rag` script + docs** — add the npm script alias so `npm run rag init` and `npx rag init` both work; document `rag init` in the README | Both invocations scaffold; README has an "Embed in your project" section | RAG-66d — **done 2026-07-29**: `"rag": "node dist/cli/main.js"` added to `package.json` scripts; README gained an "Embed in your project" section (install, file set table, `forRoot()` options, migration command). Empirically tested both invocation forms rather than assumed — `npx rag init [flags]` forwards flags cleanly; **bare `npm run rag init --target … --dry-run` (no `--`) silently swallows recognized-looking flags as npm's own** and ran with wrong defaults (target = cwd, dry-run off) — caught it because it wrote real files into this repo's own root, twice, cleaned up both times. Documented the safe forms only: `npx rag init [flags]` or `npm run rag -- init [flags]` (note the `--`). See `doc/LEARNINGS.md`. |
| RAG-66g | **End-to-end host smoke + wrap-up** — scaffold into a fresh throwaway Nest app, `import RagModule`, ingest a folder, query → cited answer; update `doc/codemap.md` + `doc/LEARNINGS.md`; commit `[eval-ok]` | A fresh host project returns a cited answer over its own corpus via the scaffold — the GO-21j done-when | RAG-66e, RAG-66f |

**Open decisions:** none blocking — forks #1–#4 settled (Nest-first host, migration-based DB
leaning on RAG-46, importable+local-install, env-first `forRoot`). Deferred (not decisions,
scope cuts): non-Nest/standalone hosts, `npm publish`, embedded auth/multi-tenant.

**Start here:** RAG-66a–f are **done** — approach guide, importable surface, typed
`forRoot(options)`, the `rag init` scaffold writer, a live end-to-end DB-path verification
(real `docker compose up` + the shipped migration runner + `rag ingest`, cross-checked in
Postgres directly), and the `npm run rag` script + README section. The only remaining piece is
**RAG-66g** — scaffold into a genuinely separate, fresh throwaway Nest app (not this repo) that
`npm install`s the packed tarball, to prove the *packaging* surface (not just the schema/ingest
logic RAG-66e already proved) works end to end — the GO-21j done-when.
