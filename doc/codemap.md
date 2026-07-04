# Code Map

> Index of files → exported symbols → where each is used. Its purpose: when a function or symbol needs to change, look it up here to see **every place affected** before editing.
>
> **Maintenance:** update after any code change — use the `codemap` skill (or dispatch the `codemap-updater` agent). Keep the "Last updated" line and the indexes in sync with `src/` and `eval/`.
>
> **Last updated:** RAG-57 floor calibration — `MIN_SCORE` default 0.2 → 0.3; eval harness gains should-abstain entries (`relevant_doc_ids: []`), `computeAbstain`, an abstain-rate summary + gate (`EVAL_MIN_ABSTAIN_RATE`), and `eval/probe-scores.ts` (ad-hoc score-distribution probe). Prior: `rag` CLI (GO-21h, RAG-52-54) — `src/cli/main.ts` + `src/cli/format.ts`, services in-process, no HTTP.

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

### `src/cli/main.ts`
- **Purpose:** The `rag` CLI entrypoint (GO-21h, RAG-52) — commander program with `ingest <path>` and `query <question>` subcommands. Bootstraps `NestFactory.createApplicationContext(AppModule, { logger: false })` (same pattern as `eval/run-eval.ts`) and calls services in-process — no HTTP. Registered as `bin: { "rag": "dist/cli/main.js" }` in `package.json`. Errors → stderr, exit 1.
- **Defines:** `withApp` (file-private helper) · commander `program` (self-executing)
- **Depends on:** `AppModule`, `IngestionService`, `GenerationService`, `formatIngestStats`/`formatQueryResult` (`./format`), `commander`
- **Used by:** — (entrypoint; invoked as `rag` / `node dist/cli/main.js`)

### `src/cli/format.ts`
- **Purpose:** Pure stdout formatting for the CLI (RAG-53/54) — no Nest/DI, unit-testable in isolation. Abstain answers pass through verbatim (D5); when a non-citation provider answered, prints an honest capability note instead of fabricated citations (RAG-62).
- **Defines:** `formatIngestStats(path, stats): string` · `formatQueryResult(result): string`
- **Depends on:** `IngestStats` (`../ingestion/ingestion.service`), `QueryResult` (`../generation/generation.service`) — types only
- **Used by:** `src/cli/main.ts` · `src/cli/format.spec.ts`

### `src/generation/generation-provider.interface.ts`
- **Purpose:** The generation swap point (TDD §2.5, D4 update) — mirrors `EmbeddingProvider`/`VectorStore`. Abstain-on-empty (D5) stays in `GenerationService`, one layer above; a provider only ever produces one grounded answer from a non-empty chunk list. `supportsCitations` is an honest capability flag — a provider without native citations returns `[]`, never a fabricated imitation.
- **Defines:** `GenerationProvider` (interface: `supportsCitations`, `generate(question, chunks)`) · `GenerationOutput` (interface) · `Citation` (interface) · `GENERATION_PROVIDER` (DI token, const)
- **Used by:** `src/generation/anthropic-generation.provider.ts` (implements) · `src/generation/openai-compatible-generation.provider.ts` (implements) · `src/generation/generation.service.ts` · `src/generation/generation.module.ts` (binds token)

### `src/generation/anthropic-generation.provider.ts`
- **Purpose:** Default `GenerationProvider` impl (D4) — Claude via native citations. Each chunk becomes a `document` content block with `citations: {enabled: true}`; response citations map back to `chunks[document_index]`. `supportsCitations = true`.
- **Defines:** `AnthropicGenerationProvider` (class) · `AnthropicGenerationProvider.generate(): Promise<GenerationOutput>`
- **Depends on:** `GenerationProvider`/`Citation`/`GenerationOutput` (interface), `Anthropic` (ctor arg), `ConfigService` (`GENERATION_MODEL`, via the module factory)
- **Used by:** `src/generation/generation.module.ts` (factory, `GENERATION_PROVIDER=anthropic`, the default)

### `src/generation/openai-compatible-generation.provider.ts`
- **Purpose:** Proves the generation seam (add-adapter skill) — any OpenAI-compatible chat-completions endpoint (OpenAI itself, or a self-hosted local server: Ollama, LM Studio, vLLM) via REST (no SDK). No native citations on this surface: `supportsCitations = false`, citations always `[]`. Chunks are inlined as numbered context in the user message.
- **Defines:** `OpenAICompatibleGenerationProvider` (class) · `OpenAICompatibleGenerationProvider.generate(): Promise<GenerationOutput>`
- **Depends on:** `GenerationProvider`/`GenerationOutput` (interface), `Logger`, global `fetch`; `baseUrl`/`model`/`apiKey` (ctor args)
- **Used by:** `src/generation/generation.module.ts` (factory, `GENERATION_PROVIDER=openai-compatible`)

### `src/generation/generation.service.ts`
- **Purpose:** Generation orchestration (RAG-25-30, D4) — retrieve → abstain-on-empty (D5, provider-agnostic policy) → delegate to the configured `GenerationProvider` for the model call.
- **Defines:** `GenerationService` (class) · `GenerationService.generate(question): Promise<QueryResult>` · `QueryResult` (interface, incl. `citationsSupported`)
- **Depends on:** `GENERATION_PROVIDER` (injected `GenerationProvider`), `RetrievalService`
- **Used by:** `src/generation/generation.controller.ts`, `src/generation/generation.module.ts`

### `src/generation/generation.controller.ts`
- **Purpose:** `POST /query { question }` (RAG-29) — validates input, delegates to the service.
- **Defines:** `GenerationController` (class) · `GenerationController.query(body): Promise<QueryResult>`
- **Depends on:** `GenerationService`
- **Used by:** `src/generation/generation.module.ts` (controller); route consumed by clients/UI

### `src/generation/generation.module.ts`
- **Purpose:** Generation feature module — imports `RetrievalModule`; binds `GENERATION_PROVIDER` via an env-selected factory (`GENERATION_PROVIDER` env: `anthropic` default | `openai-compatible`). Constructs the Anthropic client locally inside the `anthropic` branch only — no client is built when a different provider is selected.
- **Defines:** `GenerationModule` (class) · `GENERATION_PROVIDER` factory (`useFactory`)
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
- **Purpose:** Pure eval metric functions (RAG-39, RAG-57) — no I/O, NestJS, or network, so they're trivially unit-testable (`metrics.spec.ts`). An `EvalEntry` with empty `relevant_doc_ids` is a should-abstain (out-of-corpus) case.
- **Defines:** `computeMetrics(chunks, relevantDocIds): { hit, precision }` · `computeAbstain(chunks): { hit, precision }` · `formatTable(results, k): string` (separate hit-rate + abstain-rate summaries) · `EvalEntry` (interface) · `EvalResult` (interface, incl. `expectAbstain?`)
- **Depends on:** `RetrievedChunk` (`src/vector-store/vector-store.interface`)
- **Used by:** `eval/run-eval.ts`, `eval/metrics.spec.ts`

### `eval/run-eval.ts`
- **Purpose:** Eval runner (RAG-40, RAG-57) — bootstraps the real DI graph (`createApplicationContext`, no HTTP server), runs `RetrievalService.retrieve()` over `eval/dataset.jsonl`, prints the per-question table + summary, exits 1 when hit-rate < `EVAL_MIN_HIT_RATE` or abstain-rate < `EVAL_MIN_ABSTAIN_RATE`.
- **Defines:** `main(): Promise<void>` (file-private entrypoint)
- **Depends on:** `AppModule`, `RetrievalService`, `computeAbstain`/`computeMetrics`/`formatTable`/`EvalEntry`/`EvalResult` (`./metrics`), `fs`/`path`
- **Used by:** — (entrypoint; `npm run eval` via ts-node + `tsconfig.eval.json`)

### `eval/probe-scores.ts`
- **Purpose:** Ad-hoc score-distribution probe (RAG-57) — prints raw top-k similarity scores for in-corpus vs. out-of-corpus questions, bypassing the `MIN_SCORE` floor; the data behind floor calibration. Not part of `npm run eval`.
- **Defines:** `main()` / `OUT_OF_CORPUS` (file-private)
- **Depends on:** `AppModule`, `EMBEDDING_PROVIDER`/`VECTOR_STORE` (tokens), `EvalEntry` (`./metrics`), `fs`/`path`
- **Used by:** — (entrypoint; `ts-node --project tsconfig.eval.json eval/probe-scores.ts`)

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
| `GenerationProvider` | interface | `src/generation/generation-provider.interface.ts` | anthropic + openai-compatible providers, generation service, generation module |
| `GenerationOutput` | interface | `src/generation/generation-provider.interface.ts` | generation service, both providers |
| `Citation` | interface | `src/generation/generation-provider.interface.ts` | generation service, both providers |
| `GENERATION_PROVIDER` | DI token | `src/generation/generation-provider.interface.ts` | `src/generation/generation.service.ts`, `src/generation/generation.module.ts` |
| `AnthropicGenerationProvider` | class | `src/generation/anthropic-generation.provider.ts` | `src/generation/generation.module.ts` (factory, default) |
| `OpenAICompatibleGenerationProvider` | class | `src/generation/openai-compatible-generation.provider.ts` | `src/generation/generation.module.ts` (factory) |
| `GenerationService` | class | `src/generation/generation.service.ts` | generation controller, module |
| `QueryResult` | interface | `src/generation/generation.service.ts` | generation service + controller |
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
| `computeAbstain` | function | `eval/metrics.ts` | `eval/run-eval.ts`, `eval/metrics.spec.ts` |
| `formatTable` | function | `eval/metrics.ts` | `eval/run-eval.ts`, `eval/metrics.spec.ts` |
| `EvalEntry` / `EvalResult` | interface | `eval/metrics.ts` | `eval/run-eval.ts`, `eval/probe-scores.ts` |

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
| `ANTHROPIC_API_KEY` | `src/generation/generation.module.ts` (factory, `anthropic` branch only) | — |
| `GENERATION_PROVIDER` | `src/generation/generation.module.ts` (factory selection) | anthropic |
| `GENERATION_MODEL` | `src/generation/generation.module.ts` (factory → provider ctor) | claude-opus-4-8 (anthropic) |
| `GENERATION_BASE_URL` | `src/generation/generation.module.ts` (factory, `openai-compatible` branch only) | — |
| `GENERATION_API_KEY` | `src/generation/generation.module.ts` (factory, `openai-compatible` branch only) | — |
| `VOYAGE_API_KEY` | `src/embedding/embedding.module.ts` (→ `VoyageEmbeddingProvider`) | — |
| `VOYAGE_MODEL` | `src/embedding/embedding.module.ts` (→ `VoyageEmbeddingProvider` ctor) | voyage-4-lite |
| `EMBEDDING_PROVIDER` | `src/embedding/embedding.module.ts` (factory selection) | voyage |
| `RETRIEVAL_K` | `src/retrieval/retrieval.service.ts` · `eval/run-eval.ts` (table label) | 5 |
| `MIN_SCORE` | `src/retrieval/retrieval.service.ts` | 0.3 (calibrated, RAG-57) |
| `CHUNK_TOKENS` | `src/ingestion/ingestion.service.ts` (default in `DEFAULT_CHUNK_OPTIONS`) | 512 |
| `OVERLAP_TOKENS` | `src/ingestion/ingestion.service.ts` (default in `DEFAULT_CHUNK_OPTIONS`) | 64 |
| `EVAL_MIN_HIT_RATE` | `eval/run-eval.ts` (CI gate: exit 1 below floor) | 0.5 |
| `EVAL_MIN_ABSTAIN_RATE` | `eval/run-eval.ts` (CI gate: exit 1 below floor) | 0.5 |

## Non-code assets (referenced by build/runtime)

| File | Consumed by | Purpose |
|------|-------------|---------|
| `db/init/001_init.sql` | `docker-compose.yml` (db initdb mount) | `vector` extension + `chunks` table + HNSW index |
| `docker-compose.yml` | `docker compose up` | app + pgvector services |
| `Dockerfile` | `docker-compose.yml` (app build) | build/run the Nest app |
| `eval/dataset.jsonl` | `eval/run-eval.ts` · `eval/probe-scores.ts` | labeled eval set (`question` → `relevant_doc_ids[]`; empty = should abstain) |
| `eval/sample-corpus/` | `POST /ingest` before an eval run | **frozen** fixture corpus the dataset labels are tied to (rule `evals.md`) |
| `tsconfig.eval.json` | `npm run eval` (ts-node `--project`) · typecheck hook | extends root tsconfig, adds `eval/**` (kept out of `nest build`) |
| `jest.config.js` | `npm test` | ts-jest; roots `src/` + `eval/` |
