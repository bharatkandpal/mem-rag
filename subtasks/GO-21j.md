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
| RAG-66b | **Make the package importable** — `private:false`; add `main`/`types`/`exports`/`files`; `src/index.ts` barrel exporting `RagModule` + `IngestionService`/`RetrievalService`/`GenerationService` + seams/types; `npm pack` clean (no `.env`/fixtures/secrets) | A sibling project can `npm i` (file:/tarball) and `import { RagModule }`; `npm pack` ships `dist` only | RAG-66a |
| RAG-66c | **`RagModule.forRoot(options)` dynamic module** — composes the existing feature modules, re-exports the services; env-first defaults with optional overrides (`embeddingProvider`, `generationProvider`, `k`, `minScore`, `http`) | `RagModule.forRoot({})` boots the full graph from env; an override (e.g. `k`) takes effect; `http:false` omits controllers | RAG-66b |
| RAG-66d | **`rag init` subcommand (scaffold writer)** — third `commander` command in `src/cli/main.ts`; writes the §4 file set into `--target` (cwd default); idempotent (skip-existing, `--force`, `--dry-run`); prints next-steps | Running in an empty dir writes the file set; re-run is safe; `--dry-run` writes nothing | RAG-66c |
| RAG-66e | **Migration/DB path** — emit `chunks`/HNSW as a migration the host runs (not initdb-only); honor host `DATABASE_URL`; carry the `VECTOR(1024)` dims-trap comment | A scaffolded host applies the schema via the migration runner and ingest works | RAG-66d, **RAG-46** |
| RAG-66f | **`npm run rag` script + docs** — add the npm script alias so `npm run rag init` and `npx rag init` both work; document `rag init` in the README | Both invocations scaffold; README has an "Embed in your project" section | RAG-66d |
| RAG-66g | **End-to-end host smoke + wrap-up** — scaffold into a fresh throwaway Nest app, `import RagModule`, ingest a folder, query → cited answer; update `doc/codemap.md` + `doc/LEARNINGS.md`; commit `[eval-ok]` | A fresh host project returns a cited answer over its own corpus via the scaffold — the GO-21j done-when | RAG-66e, RAG-66f |

**Open decisions:** none blocking — forks #1–#4 settled (Nest-first host, migration-based DB
leaning on RAG-46, importable+local-install, env-first `forRoot`). Deferred (not decisions,
scope cuts): non-Nest/standalone hosts, `npm publish`, embedded auth/multi-tenant.

**Start here:** RAG-66a is done (the approach guide). The next actionable move is **RAG-66b**
(make the package importable) — it's **not gated** (RAG-46 only blocks RAG-66e), so the package
surface + `forRoot` + the generator writer (b → c → d) can all proceed now; pull **RAG-46**
forward in parallel to unblock the DB path (e) and land the host smoke (g).
