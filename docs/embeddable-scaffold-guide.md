# Embeddable Scaffold Approach — `npm run rag init` (GO-21j / RAG-66)

> The **approach note to follow** for the embeddable-scaffold deliverable: a `rag init`
> generator that writes the RAG capability *into a host project*, so an integrator embeds RAG
> rather than just running this app. Companion to [`ui-design-guide.md`](ui-design-guide.md)
> and [`observability-guide.md`](observability-guide.md). Sliced in
> [`subtasks/GO-21j.md`](../subtasks/GO-21j.md).
>
> **Shape decided 2026-07-23 (generator), forks settled 2026-07-24.** This is the PRD
> "Integrator" persona (`PRD §3`) made one-command, and the sharpest proof of the "pluggable,
> no vendor lock-in" thesis.

---

## 0. The two surfaces this needs

`rag init` is only half the work. Embedding RAG in a host project needs **both**:

1. **An importable package surface** — today the repo is `private: true` with no `main`/
   `types`/`exports`. A host can't `import { RagModule }` from it. We must expose a library
   barrel and a `RagModule.forRoot()` dynamic module.
2. **The `rag init` generator** — a `commander` subcommand (a third alongside `ingest`/`query`
   in `src/cli/main.ts`) + an `npm run rag` script that writes wiring + config into the target
   project.

The generator is worthless without the package surface (the files it writes `import` from it),
so the package surface is built first.

---

## 1. Decisions locked

| # | Fork | Decision |
|---|---|---|
| 1 | Host scope | **Nest-first.** `RagModule` *is* a Nest module, so the scaffold targets a NestJS host. A non-Nest/standalone adapter is explicitly deferred. |
| 2 | Database in scaffold | Emit the `chunks`/HNSW schema as a **migration** the host runs (leans on **RAG-46**, the migration runner — initdb-only won't survive a host embed), **plus** an optional self-contained pgvector compose service for a zero-setup demo. Host may bring its own Postgres via `DATABASE_URL`. |
| 3 | Distribution | **Importable + local install now** (`file:`/git/`npm pack` tarball); actual `npm publish` is optional and out of scope for the deliverable. |
| 4 | `forRoot()` surface | **Env-first defaults, optional overrides** for the embedding/generation provider, `RETRIEVAL_K`, and `MIN_SCORE`. Same config the app reads today, just overridable in code. |

---

## 2. The importable package surface (build first)

- **`package.json`:** `private: false`; add `main`/`module`/`types` (point at `dist/index`),
  an `exports` map, and a `files` whitelist (`dist` only). The `files` whitelist is also the
  **secrets guard** — never ship `.env`, `db/`, or test fixtures (rule `ai-and-secrets.md`).
- **Barrel `src/index.ts`** — the public API, nothing more:
  - `RagModule` (new dynamic module, §3)
  - services: `IngestionService`, `RetrievalService`, `GenerationService`
  - seams + types: `EmbeddingProvider`, `VectorStore` + `RetrievedChunk`,
    `GenerationProvider` + `Citation` + `GenerationOutput`, and `QueryResult`
- **`npm pack` must be clean** — inspect the tarball: `dist` + `package.json` + README only; no
  keys, no `.env`, no `eval/sample-corpus`.

---

## 3. `RagModule.forRoot(options)`

A `DynamicModule` that composes the existing feature modules (`EmbeddingModule`,
`VectorStoreModule`, `IngestionModule`, `RetrievalModule`, `GenerationModule`) and re-exports
the three services — **it does not re-implement anything**. It's the single import a host adds.

```ts
RagModule.forRoot({
  // all optional — omitted values fall back to env (today's behavior)
  embeddingProvider?: 'voyage' | EmbeddingProvider,
  generationProvider?: 'anthropic' | 'openai-compatible' | GenerationProvider,
  k?: number,                 // default RETRIEVAL_K
  minScore?: number,          // default MIN_SCORE
  http?: boolean,             // default false — register /ingest,/query controllers?
})
```

- **Env-first:** with `forRoot({})` and env set, the host gets exactly the app's behavior.
- **`http` flag:** a host embedding the *services* usually doesn't want our HTTP routes; default
  `false` (services only). `true` registers the controllers for a host that wants the endpoints.
- Reuses the same DI seams (`EMBEDDING_PROVIDER`, `GENERATION_PROVIDER` tokens) so overrides
  slot in at the existing swap points — no new seam invented.

---

## 4. What `rag init` writes into the host

Idempotent generator. Targets the current working directory (or `--target <dir>`); detects an
existing file and **skips unless `--force`**; supports `--dry-run`.

| File written | Purpose | If it exists |
|---|---|---|
| `src/rag/rag.module.ts` | Thin host module that `imports: [RagModule.forRoot({…})]` | skip (`--force` to overwrite) |
| `.env.rag.example` | `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `RETRIEVAL_K`, `MIN_SCORE` (placeholders) | skip |
| `docker-compose.rag.yml` | Optional self-contained pgvector service | skip |
| `db/rag/001_init.sql` | `chunks` table + HNSW index (the migration, §1 #2) | skip |
| console "next steps" | Add `RagModule` to `AppModule`, set env, run migration, `docker compose up` | — |

> **Reuse discipline:** the generator *writes files that import the package*; it never copies
> pipeline logic. The scaffolded host runs the same `IngestionService`/`GenerationService` this
> repo ships — one pipeline, now three entrypoints (HTTP, CLI, embedded).

---

## 5. The `VECTOR(1024)` dims trap (call it out in the scaffold)

The schema is `VECTOR(1024)`, pinned to Voyage's `output_dimension`. A host that swaps to a
non-1024 embedding model (via `forRoot({ embeddingProvider })`) must change the migration and
re-ingest — it's not a drop-in. The `.env.rag.example` and the generated SQL both carry a
comment stating this, so an integrator can't silently mismatch dims (cross-refs RAG-56).

---

## 6. Definition of done (when built — not this planning slice)

1. A **fresh throwaway Nest app** can: install the package (`file:`/tarball), run `rag init`,
   add `RagModule` to its `AppModule`, apply the migration, ingest a folder, and get a **cited
   answer over its own corpus**. That end-to-end host smoke *is* the GO-21j done-when.
2. `npm run rag init` **and** `npx rag init` both scaffold (script + bin wired).
3. `rag init` is idempotent: re-run is safe, `--force`/`--dry-run` behave.
4. `npm pack` ships no secrets/fixtures; `files` whitelist verified.
5. Codemap + `doc/LEARNINGS.md` updated (new module, barrel, subcommand, package fields).
   **Not retrieval-affecting** → no eval run (`[eval-ok]`, rule `evals.md`).

**Out of scope (now):** non-Nest/standalone hosts, `npm publish` to the public registry,
multi-tenant/auth in the embedded module.

---

## 7. Dependency to flag

The clean DB path (§1 #2) depends on **RAG-46 (real migration runner)** — the *same* dependency
RAG-64 (container deploy) has. RAG-46 is now on the critical path for two embed stories, so it's
worth pulling forward. Everything else in the ladder (package surface, `forRoot`, the generator
writer) is independent of RAG-46 and can proceed in parallel.
