# Code Map

> Index of files → exported symbols → where each is used. Its purpose: when a function or symbol needs to change, look it up here to see **every place affected** before editing.
>
> **Maintenance:** update after any code change — use the `codemap` skill (or dispatch the `codemap-updater` agent). Keep the "Last updated" line and the indexes in sync with `src/` and `eval/`.
>
> **Last updated:** embedding default → `voyage-4-lite` via `VOYAGE_MODEL` (D3 update) · eval harness entries (RAG-38-40). (GO-21a–d complete.)

---

## Files

### `src/main.ts`
- **Purpose:** App entrypoint — bootstraps Nest, reads `PORT`, starts the HTTP server.
- **Defines:** `bootstrap(): Promise<void>`
- **Depends on:** `AppModule` (`./app.module`), `ConfigService` (`@nestjs/config`), `NestFactory`, `Logger`
- **Used by:** — (entrypoint; self-invoked via `void bootstrap()`)

### `src/app.module.ts`
- **Purpose:** Root module — wires global config + feature modules.
- **Defines:** `AppModule` (class)
- **Imports:** `ConfigModule.forRoot({ isGlobal: true })`, `DatabaseModule`, `EmbeddingModule`, `VectorStoreModule`, `IngestionModule`, `RetrievalModule`, `HealthModule`
- **Used by:** `src/main.ts`

### `src/generation/generation.service.ts`
- **Purpose:** Generation with native citations (RAG-25-30, D4) — retrieve → pass chunks as `document` blocks with citations → cited answer; abstain on empty retrieval (D5).
- **Defines:** `GenerationService` (class) · `GenerationService.generate(question): Promise<QueryResult>` · `QueryResult` / `Citation` (interfaces) · `ANTHROPIC_CLIENT` (DI token, const)
- **Depends on:** `ANTHROPIC_CLIENT` (injected `Anthropic`), `RetrievalService`, `ConfigService` (`GENERATION_MODEL`)
- **Used by:** `src/generation/generation.controller.ts`, `src/generation/generation.module.ts`

### `src/generation/generation.controller.ts`
- **Purpose:** `POST /query { question }` (RAG-29) — validates input, delegates to the service.
- **Defines:** `GenerationController` (class) · `GenerationController.query(body): Promise<QueryResult>`
- **Depends on:** `GenerationService`
- **Used by:** `src/generation/generation.module.ts` (controller); route consumed by clients/UI

### `src/generation/generation.module.ts`
- **Purpose:** Generation feature module — imports `RetrievalModule`, binds `ANTHROPIC_CLIENT` from `ANTHROPIC_API_KEY`.
- **Defines:** `GenerationModule` (class) · Anthropic client factory
- **Used by:** `src/app.module.ts`

### `src/retrieval/retrieval.service.ts`
- **Purpose:** Retrieval (RAG-20/23) — embed query → store cosine top-k → drop below min-score floor. Owns k + floor policy (config); returns `[]` to enable abstain (D5).
- **Defines:** `RetrievalService` (class) · `RetrievalService.retrieve(query): Promise<RetrievedChunk[]>` · `toNumber` (file-private)
- **Depends on:** `EMBEDDING_PROVIDER` (injected), `VECTOR_STORE` (injected), `ConfigService` (`RETRIEVAL_K`/`MIN_SCORE`)
- **Used by:** `src/retrieval/retrieval.module.ts`; consumed by generation (RAG-27)

### `src/retrieval/retrieval.module.ts`
- **Purpose:** Retrieval feature module — provides + exports `RetrievalService` (no controller; reached via `/query`).
- **Defines:** `RetrievalModule` (class)
- **Used by:** `src/app.module.ts`

### `src/ingestion/ingestion.service.ts`
- **Purpose:** The ingestion pipeline (RAG-16) — `load → chunk → embed → upsert`; thin orchestrator over the loader + the two adapter interfaces.
- **Defines:** `IngestionService` (class) · `IngestionService.ingest(path): Promise<IngestStats>` · `IngestStats` (interface)
- **Depends on:** `DocumentLoader`, `EMBEDDING_PROVIDER` (injected), `VECTOR_STORE` (injected), `ConfigService` (`CHUNK_TOKENS`/`OVERLAP_TOKENS`), `chunk` (`./chunker`)
- **Used by:** `src/ingestion/ingestion.controller.ts`, `src/ingestion/ingestion.module.ts`

### `src/ingestion/ingestion.controller.ts`
- **Purpose:** `POST /ingest { path }` (RAG-17) — validates input, delegates to the service.
- **Defines:** `IngestionController` (class) · `IngestionController.ingest(body): Promise<IngestStats>`
- **Depends on:** `IngestionService`
- **Used by:** `src/ingestion/ingestion.module.ts` (controller); route consumed by clients

### `src/ingestion/ingestion.module.ts`
- **Purpose:** Ingestion feature module — provides `IngestionService` + `DocumentLoader`, registers the controller.
- **Defines:** `IngestionModule` (class)
- **Used by:** `src/app.module.ts`

### `src/ingestion/document-loader.ts`
- **Purpose:** Load a corpus (file or dir) into `LoadedDocument[]` (RAG-14). Handles `.md`/`.txt`, skips others; PDF is a later slice.
- **Defines:** `DocumentLoader` (class) · `DocumentLoader.load(rootPath): Promise<LoadedDocument[]>` · `LoadedDocument` (interface)
- **Depends on:** `fs/promises`, `path`, `Logger`
- **Used by:** — (ingestion service wires it at RAG-16)

### `src/ingestion/chunker.ts`
- **Purpose:** Recursive structure-aware, token-budgeted chunker with overlap (RAG-15, D9).
- **Defines:** `chunk(text, opts): TextChunk[]` · `TextChunk` (interface) · `ChunkOptions` (interface) · `DEFAULT_CHUNK_OPTIONS` (const) · `segment`/`pack` (file-private)
- **Depends on:** `countTokens`/`splitByTokens`/`tailByTokens` (`./tokenizer`)
- **Used by:** — (ingestion service wires it at RAG-16)

### `src/ingestion/tokenizer.ts`
- **Purpose:** Token-counting/splitting wrapper (D9) — single swap point for the tokenizer.
- **Defines:** `countTokens(text)` · `splitByTokens(text, max)` · `tailByTokens(text, n)`
- **Depends on:** `gpt-tokenizer` (`encode`/`decode`)
- **Used by:** `src/ingestion/chunker.ts`

### `src/vector-store/vector-store.interface.ts`
- **Purpose:** The vector-store swap point (TDD §2.2) — ingestion/retrieval depend on this, never on pgvector directly.
- **Defines:** `VectorStore` (interface: `upsert`, `search`) · `ChunkInput` (interface) · `RetrievedChunk` (interface) · `VECTOR_STORE` (DI token, const)
- **Used by:** `src/vector-store/pgvector.store.ts` (implements) · `src/vector-store/vector-store.module.ts` (binds token)

### `src/vector-store/pgvector.store.ts`
- **Purpose:** Postgres + pgvector impl — idempotent batch `upsert` (ON CONFLICT on `(doc_id, chunk_index)`) + cosine top-k `search` (`<=>` over HNSW). All SQL/pgvector specifics contained here.
- **Defines:** `PgVectorStore` (class) · `PgVectorStore.upsert(): Promise<number>` · `PgVectorStore.search(): Promise<RetrievedChunk[]>`
- **Depends on:** `VectorStore`/`ChunkInput` (interface), `Pool` (`pg`, ctor arg), `Logger`
- **Used by:** `src/vector-store/vector-store.module.ts` (factory)

### `src/vector-store/vector-store.module.ts`
- **Purpose:** Global module — binds `VECTOR_STORE` token to `PgVectorStore` over the shared `PG_POOL`.
- **Defines:** `VectorStoreModule` (class, `@Global`) · provider factory (`useFactory` → `new PgVectorStore(pool)`)
- **Exports:** `VECTOR_STORE`
- **Depends on:** `PG_POOL`, `PgVectorStore`
- **Used by:** `src/app.module.ts` (import); token injected by ingestion/retrieval in later milestones

### `src/embedding/embedding-provider.interface.ts`
- **Purpose:** The embedding swap point (TDD §2.1) — ingestion/retrieval depend on this, never on a concrete provider.
- **Defines:** `EmbeddingProvider` (interface: `dims`, `embed(texts)`) · `EMBEDDING_PROVIDER` (DI token, const)
- **Used by:** `src/embedding/voyage-embedding.provider.ts` (implements) · `src/embedding/embedding.module.ts` (binds token)

### `src/embedding/voyage-embedding.provider.ts`
- **Purpose:** Default `EmbeddingProvider` impl — Voyage (default `voyage-4-lite`, env `VOYAGE_MODEL`), 1024 dims pinned via `output_dimension`, via REST (no SDK). All Voyage-specific code contained here.
- **Defines:** `VoyageEmbeddingProvider` (class) · `VoyageEmbeddingProvider.embed(): Promise<number[][]>`
- **Depends on:** `EmbeddingProvider` (interface), `Logger`, global `fetch`; `VOYAGE_API_KEY` (ctor arg)
- **Used by:** `src/embedding/embedding.module.ts` (factory)

### `src/embedding/embedding.module.ts`
- **Purpose:** Global module — binds `EMBEDDING_PROVIDER` token to the impl selected by `EMBEDDING_PROVIDER` env (factory, RAG-11).
- **Defines:** `EmbeddingModule` (class, `@Global`) · provider factory (`useFactory` → selects `VoyageEmbeddingProvider`)
- **Exports:** `EMBEDDING_PROVIDER`
- **Depends on:** `ConfigService`, `VoyageEmbeddingProvider`
- **Used by:** `src/app.module.ts` (import); token injected by ingestion/retrieval in later milestones

### `src/database/database.module.ts`
- **Purpose:** Global Postgres connection pool (the `VectorStore` seam will attach here in GO-21b).
- **Defines:** `PG_POOL` (DI token, const) · `DatabaseModule` (class, `@Global`) · pool factory (`useFactory` → `new Pool({ connectionString: DATABASE_URL })`)
- **Exports:** `PG_POOL`
- **Depends on:** `ConfigService`, `Pool` (`pg`)
- **Used by:** `src/app.module.ts` (import) · `src/health/health.controller.ts` (injects `PG_POOL`)

### `src/health/health.module.ts`
- **Purpose:** Health feature module.
- **Defines:** `HealthModule` (class)
- **Declares:** `HealthController`
- **Used by:** `src/app.module.ts`

### `src/health/health.controller.ts`
- **Purpose:** `GET /healthz` — verifies DB reachable + `vector` extension present.
- **Defines:** `HealthController` (class) · `HealthController.check(): Promise<HealthReport>` · `HealthReport` (interface)
- **Depends on:** `PG_POOL` (injected `Pool`)
- **Used by:** `src/health/health.module.ts` (controller); route consumed by clients / docker healthcheck path

### `eval/metrics.ts`
- **Purpose:** Pure eval metric functions (RAG-39) — no I/O, NestJS, or network, so they're trivially unit-testable (`metrics.spec.ts`).
- **Defines:** `computeMetrics(chunks, relevantDocIds): { hit, precision }` · `formatTable(results, k): string` · `EvalEntry` (interface) · `EvalResult` (interface)
- **Depends on:** `RetrievedChunk` (`src/vector-store/vector-store.interface`)
- **Used by:** `eval/run-eval.ts`, `eval/metrics.spec.ts`

### `eval/run-eval.ts`
- **Purpose:** Eval runner (RAG-40) — bootstraps the real DI graph (`createApplicationContext`, no HTTP server), runs `RetrievalService.retrieve()` over `eval/dataset.jsonl`, prints the per-question table + summary, exits 1 when hit-rate < `EVAL_MIN_HIT_RATE`.
- **Defines:** `main(): Promise<void>` (file-private entrypoint)
- **Depends on:** `AppModule`, `RetrievalService`, `computeMetrics`/`formatTable`/`EvalEntry`/`EvalResult` (`./metrics`), `fs`/`path`
- **Used by:** — (entrypoint; `npm run eval` via ts-node + `tsconfig.eval.json`)

---

## Symbol → usage index

| Symbol | Kind | Defined in | Used in |
|--------|------|-----------|---------|
| `bootstrap` | function | `src/main.ts` | self (entrypoint) |
| `AppModule` | class | `src/app.module.ts` | `src/main.ts` |
| `DatabaseModule` | class | `src/database/database.module.ts` | `src/app.module.ts` |
| `PG_POOL` | DI token | `src/database/database.module.ts` | `src/health/health.controller.ts` |
| `EmbeddingProvider` | interface | `src/embedding/embedding-provider.interface.ts` | voyage provider, embedding module (+ ingestion/retrieval later) |
| `EMBEDDING_PROVIDER` | DI token | `src/embedding/embedding-provider.interface.ts` | `src/embedding/embedding.module.ts` |
| `VoyageEmbeddingProvider` | class | `src/embedding/voyage-embedding.provider.ts` | `src/embedding/embedding.module.ts` |
| `EmbeddingModule` | class | `src/embedding/embedding.module.ts` | `src/app.module.ts` |
| `VectorStore` | interface | `src/vector-store/vector-store.interface.ts` | pgvector store, vector-store module (+ ingestion/retrieval later) |
| `ChunkInput` | interface | `src/vector-store/vector-store.interface.ts` | `src/vector-store/pgvector.store.ts` (+ ingestion later) |
| `VECTOR_STORE` | DI token | `src/vector-store/vector-store.interface.ts` | `src/vector-store/vector-store.module.ts` |
| `PgVectorStore` | class | `src/vector-store/pgvector.store.ts` | `src/vector-store/vector-store.module.ts` |
| `VectorStoreModule` | class | `src/vector-store/vector-store.module.ts` | `src/app.module.ts` |
| `GenerationService` | class | `src/generation/generation.service.ts` | generation controller, module |
| `QueryResult` / `Citation` | interface | `src/generation/generation.service.ts` | generation service + controller |
| `ANTHROPIC_CLIENT` | DI token | `src/generation/generation.service.ts` | `src/generation/generation.module.ts` |
| `GenerationController` | class | `src/generation/generation.controller.ts` | `src/generation/generation.module.ts` |
| `GenerationModule` | class | `src/generation/generation.module.ts` | `src/app.module.ts` |
| `RetrievalService` | class | `src/retrieval/retrieval.service.ts` | retrieval module; `src/generation/generation.service.ts` |
| `RetrievalModule` | class | `src/retrieval/retrieval.module.ts` | `src/app.module.ts` |
| `RetrievedChunk` | interface | `src/vector-store/vector-store.interface.ts` | pgvector `search`, retrieval service, `eval/metrics.ts` |
| `IngestionService` | class | `src/ingestion/ingestion.service.ts` | ingestion controller, module |
| `IngestStats` | interface | `src/ingestion/ingestion.service.ts` | ingestion service + controller (return type) |
| `IngestionController` | class | `src/ingestion/ingestion.controller.ts` | `src/ingestion/ingestion.module.ts` |
| `IngestionModule` | class | `src/ingestion/ingestion.module.ts` | `src/app.module.ts` |
| `DocumentLoader` | class | `src/ingestion/document-loader.ts` | `src/ingestion/ingestion.service.ts` |
| `LoadedDocument` | interface | `src/ingestion/document-loader.ts` | `src/ingestion/ingestion.service.ts` |
| `chunk` | function | `src/ingestion/chunker.ts` | `src/ingestion/ingestion.service.ts` |
| `TextChunk` | interface | `src/ingestion/chunker.ts` | `src/ingestion/ingestion.service.ts` |
| `ChunkOptions` / `DEFAULT_CHUNK_OPTIONS` | interface/const | `src/ingestion/chunker.ts` | chunker, ingestion config (RAG-16) |
| `countTokens` / `splitByTokens` / `tailByTokens` | functions | `src/ingestion/tokenizer.ts` | `src/ingestion/chunker.ts` |
| `HealthModule` | class | `src/health/health.module.ts` | `src/app.module.ts` |
| `HealthController` | class | `src/health/health.controller.ts` | `src/health/health.module.ts` |
| `HealthController.check` | method | `src/health/health.controller.ts` | route `GET /healthz` |
| `HealthReport` | interface | `src/health/health.controller.ts` | `src/health/health.controller.ts` (return type) |
| `computeMetrics` | function | `eval/metrics.ts` | `eval/run-eval.ts`, `eval/metrics.spec.ts` |
| `formatTable` | function | `eval/metrics.ts` | `eval/run-eval.ts`, `eval/metrics.spec.ts` |
| `EvalEntry` / `EvalResult` | interface | `eval/metrics.ts` | `eval/run-eval.ts` |

## HTTP routes

| Method | Path | Handler | File |
|--------|------|---------|------|
| GET | `/healthz` | `HealthController.check` | `src/health/health.controller.ts` |
| POST | `/ingest` | `IngestionController.ingest` | `src/ingestion/ingestion.controller.ts` |
| POST | `/query` | `GenerationController.query` | `src/generation/generation.controller.ts` |

## Env vars → read in

| Var | Read in | Default |
|-----|---------|---------|
| `PORT` | `src/main.ts` | 3000 |
| `DATABASE_URL` | `src/database/database.module.ts` | — |
| `ANTHROPIC_API_KEY` | `src/generation/generation.module.ts` (→ Anthropic client) | — |
| `GENERATION_MODEL` | `src/generation/generation.service.ts` | claude-opus-4-8 |
| `VOYAGE_API_KEY` | `src/embedding/embedding.module.ts` (→ `VoyageEmbeddingProvider`) | — |
| `VOYAGE_MODEL` | `src/embedding/embedding.module.ts` (→ `VoyageEmbeddingProvider` ctor) | voyage-4-lite |
| `EMBEDDING_PROVIDER` | `src/embedding/embedding.module.ts` (factory selection) | voyage |
| `RETRIEVAL_K` | `src/retrieval/retrieval.service.ts` · `eval/run-eval.ts` (table label) | 5 |
| `MIN_SCORE` | `src/retrieval/retrieval.service.ts` | 0.2 |
| `CHUNK_TOKENS` | `src/ingestion/ingestion.service.ts` (default in `DEFAULT_CHUNK_OPTIONS`) | 512 |
| `OVERLAP_TOKENS` | `src/ingestion/ingestion.service.ts` (default in `DEFAULT_CHUNK_OPTIONS`) | 64 |
| `EVAL_MIN_HIT_RATE` | `eval/run-eval.ts` (CI gate: exit 1 below floor) | 0.5 |

## Non-code assets (referenced by build/runtime)

| File | Consumed by | Purpose |
|------|-------------|---------|
| `db/init/001_init.sql` | `docker-compose.yml` (db initdb mount) | `vector` extension + `chunks` table + HNSW index |
| `docker-compose.yml` | `docker compose up` | app + pgvector services |
| `Dockerfile` | `docker-compose.yml` (app build) | build/run the Nest app |
| `eval/dataset.jsonl` | `eval/run-eval.ts` | labeled eval set (`question` → `relevant_doc_ids[]`) |
| `eval/sample-corpus/` | `POST /ingest` before an eval run | **frozen** fixture corpus the dataset labels are tied to (rule `evals.md`) |
| `tsconfig.eval.json` | `npm run eval` (ts-node `--project`) · typecheck hook | extends root tsconfig, adds `eval/**` (kept out of `nest build`) |
| `jest.config.js` | `npm test` | ts-jest; roots `src/` + `eval/` |
