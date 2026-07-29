# Code Map

> Index of files → exported symbols → where each is used. Its purpose: when a function or symbol needs to change, look it up here to see **every place affected** before editing.
>
> **Maintenance:** update after any code change — use the `codemap` skill (or dispatch the `codemap-updater` agent). Keep the "Last updated" line and the indexes in sync with `src/` and `eval/`.
>
> **Last updated:** RAG-67 key-free local slice — `TransformersEmbeddingProvider.defaultLoader` honours `TRANSFORMERS_CACHE` (relocatable weight cache off the read-only `node_modules` path); Dockerfile pre-creates a nonroot-owned `/hf-cache` + sets `TRANSFORMERS_CACHE`; new `docker-compose.local.yml` overlay runs the stack key-free (transformers embeddings + Ollama generation). Prior: RAG-57 floor calibration — `MIN_SCORE` default 0.2 → 0.3; eval harness gains should-abstain entries (`relevant_doc_ids: []`), `computeAbstain`, an abstain-rate summary + gate (`EVAL_MIN_ABSTAIN_RATE`), and `eval/probe-scores.ts` (ad-hoc score-distribution probe).

---

## Files

### `src/main.ts`
- **Purpose:** App entrypoint — bootstraps Nest, serves the static chat UI (`useStaticAssets` → `../web/public`, same origin as `/query`), reads `PORT`, starts the HTTP server.
- **Defines:** `bootstrap(): Promise<void>`
- **Depends on:** `AppModule` (`./app.module`), `ConfigService` (`@nestjs/config`), `NestFactory`, `NestExpressApplication` (`@nestjs/platform-express`), `join` (`path`), `Logger`, `CorrelatedLogger` (`./observability/correlated-logger`, via `app.useLogger` — RAG-63c)
- **Used by:** — (entrypoint; self-invoked via `void bootstrap()`)
- **Serves:** `web/public/index.html` — single-page chat UI (vanilla, no build) that POSTs `/query` and renders the cited answer + a References panel; baked into the image (`Dockerfile COPY web/public`) and bind-mounted for live edits (`docker-compose.yml`). *(GO-21e-g will repoint this at the `web/` React build.)*

### `web/` — chat UI (React 18 + Vite + TS, GO-21e)
Separate npm package (`web/package.json`, own `node_modules`/lockfile), scaffolded in GO-21e-b. Dev server proxies `/query` (+ `/query/general`), `/healthz`, `/metrics` → Nest (`vite.config.ts`, `publicDir:false` so it doesn't claim the legacy `web/public/` prototype). GO-21e-c added the design-token system + `AppShell`; the four render branches (Conversation/AnswerBody/SourcesPanel/state cards) land in GO-21e-d…f.
- **`web/src/types.ts`** — `Citation`, `RetrievedChunk`, `QueryResult` — a mirror of `QueryResult` in `src/generation/generation.service.ts` (server is source of truth); keep in lockstep.
- **`web/src/api.ts`** — `fetchQuery(question, signal?): Promise<QueryResult>` (the only network surface) + `QueryError` (carries `status` + `correlationId` from the RAG-63 error body / `x-request-id`).
- **`web/src/state.ts`** — `AppState`/`Phase`/`Action`/`QueryError` + `reducer`, `initialState` — the one-query-flow reducer (`empty→loading→answered|abstained|error`); `success` picks `answered` vs `abstained` from `result.abstained`. Used by `App.tsx`.
- **`web/src/hooks/useTheme.ts`** — `useTheme()` → `{theme, toggle}`; mirrors `data-theme` on `<html>` + persists to `localStorage` (`rag-theme`), defaulting to OS preference. Paired with the pre-paint script in `index.html`.
- **`web/src/App.tsx`** — `App` — composes `AppShell` + `EmptyState` around the reducer + `fetchQuery`; non-empty phases use an interim result view (placeholder for GO-21e-d…f, styled by `interim.css`).
- **`web/src/main.tsx`** — React root mount (imports `index.css` → `styles/tokens.css`).
- **`web/src/components/`** (GO-21e-c) — `AppShell` (theme owner + 3-row grid: header/scroll/composer), `Header`, `StatusBadge` (`citationsSupported: boolean|null` → citations/no-citations/idle), `ThemeToggle`, `Composer` (autofocus, auto-grow, ⌘/Ctrl+Enter), `EmptyState` (intro + example-question chips). Each has a co-located `.css`; all colors/spacing reference tokens.

### `src/app.module.ts`
- **Purpose:** Root module — wires global config + feature modules.
- **Defines:** `AppModule` (class)
- **Imports:** `ConfigModule.forRoot({ isGlobal: true })`, `ObservabilityModule`, `DatabaseModule`, `EmbeddingModule`, `VectorStoreModule`, `IngestionModule`, `RetrievalModule`, `GenerationModule`, `HealthModule`
- **Used by:** `src/main.ts`

### `src/cli/main.ts`
- **Purpose:** The `rag` CLI entrypoint (GO-21h, RAG-52) — commander program with `ingest <path>` and `query <question>` subcommands. Bootstraps `NestFactory.createApplicationContext(AppModule, { logger: false })` silent, then attaches `CorrelatedLogger` and runs each command body in one ALS correlation scope (RAG-63g) so operational logs carry one id per invocation. Calls services in-process — no HTTP. Registered as `bin: { "rag": "dist/cli/main.js" }`. Errors → stderr, exit 1.
- **Defines:** `withApp` (file-private helper — bootstraps, sets logger, wraps `fn` in `runWithCorrelation`) · commander `program` (self-executing)
- **Depends on:** `AppModule`, `IngestionService`, `GenerationService`, `CorrelatedLogger` + `runWithCorrelation` (`../observability/*`), `randomUUID` (`node:crypto`), `formatIngestStats`/`formatQueryResult` (`./format`), `commander`
- **Used by:** — (entrypoint; invoked as `rag` / `node dist/cli/main.js`)

### `src/cli/format.ts`
- **Purpose:** Pure stdout formatting for the CLI (RAG-53/54) — no Nest/DI, unit-testable in isolation. Abstain answers pass through verbatim (D5); when a non-citation provider answered, prints an honest capability note instead of fabricated citations (RAG-62).
- **Defines:** `formatIngestStats(path, stats): string` · `formatQueryResult(result): string`
- **Depends on:** `IngestStats` (`../ingestion/ingestion.service`), `QueryResult` (`../generation/generation.service`) — types only
- **Used by:** `src/cli/main.ts` · `src/cli/format.spec.ts`

### `src/generation/generation-provider.interface.ts`
- **Purpose:** The generation swap point (TDD §2.5, D4 update) — mirrors `EmbeddingProvider`/`VectorStore`. Abstain-on-empty (D5) stays in `GenerationService`, one layer above; a provider only ever produces one grounded answer from a non-empty chunk list. `supportsCitations` is an honest capability flag — a provider without native citations returns `[]`, never a fabricated imitation.
- **Defines:** `GenerationProvider` (interface: `name` — stable low-cardinality provider id for the `rag_generation_duration_seconds` label (RAG-63e); `supportsCitations`; `generate(question, chunks)`; `generateGeneral(question)` — explicit opt-in ungrounded answer, not corpus, never cited) · `GenerationOutput` (interface) · `Citation` (interface) · `GENERATION_PROVIDER` (DI token, const)
- **Used by:** `src/generation/anthropic-generation.provider.ts` (implements) · `src/generation/openai-compatible-generation.provider.ts` (implements) · `src/generation/generation.service.ts` · `src/generation/generation.module.ts` (binds token)

### `src/generation/anthropic-generation.provider.ts`
- **Purpose:** Default `GenerationProvider` impl (D4) — Claude via native citations. Each chunk becomes a `document` content block with `citations: {enabled: true}`; response citations map back to `chunks[document_index]`. `supportsCitations = true`.
- **Defines:** `AnthropicGenerationProvider` (class) · `AnthropicGenerationProvider.generate(): Promise<GenerationOutput>` · `.generateGeneral(question): Promise<string>` (ungrounded, no document blocks)
- **Depends on:** `GenerationProvider`/`Citation`/`GenerationOutput` (interface), `Anthropic` (ctor arg), `ConfigService` (`GENERATION_MODEL`, via the module factory)
- **Used by:** `src/generation/generation.module.ts` (factory, `GENERATION_PROVIDER=anthropic`, the default)

### `src/generation/openai-compatible-generation.provider.ts`
- **Purpose:** Proves the generation seam (add-adapter skill) — any OpenAI-compatible chat-completions endpoint (OpenAI itself, or a self-hosted local server: Ollama, LM Studio, vLLM) via REST (no SDK). No native citations on this surface: `supportsCitations = false`, citations always `[]`. Chunks are inlined as numbered context in the user message.
- **Defines:** `OpenAICompatibleGenerationProvider` (class) · `OpenAICompatibleGenerationProvider.generate(): Promise<GenerationOutput>` · `.generateGeneral(question): Promise<string>` · private `.chat(messages): Promise<string>` (shared POST to `/chat/completions`)
- **Depends on:** `GenerationProvider`/`GenerationOutput` (interface), `Logger`, global `fetch`; `baseUrl`/`model`/`apiKey` (ctor args)
- **Used by:** `src/generation/generation.module.ts` (factory, `GENERATION_PROVIDER=openai-compatible`)

### `src/generation/generation.service.ts`
- **Purpose:** Generation orchestration (RAG-25-30, D4) — retrieve → abstain-on-empty (D5, provider-agnostic policy) → delegate to the configured `GenerationProvider` for the model call. Records `rag_query_total{outcome}` (grounded/abstained/general) + `rag_generation_duration_seconds{provider}` (RAG-63e).
- **Defines:** `GenerationService` (class) · `GenerationService.generate(question): Promise<QueryResult>` · `.generateGeneral(question): Promise<QueryResult>` (opt-in ungrounded; bypasses retrieval; `grounded:false`) · `QueryResult` (interface, incl. `citationsSupported`, `grounded`)
- **Depends on:** `GENERATION_PROVIDER` (injected `GenerationProvider`), `RetrievalService`, `MetricsService` (`@Optional`, RAG-63e)
- **Used by:** `src/generation/generation.controller.ts`, `src/generation/generation.module.ts`

### `src/generation/generation.controller.ts`
- **Purpose:** `POST /query { question }` (RAG-29) grounded, and `POST /query/general { question }` (opt-in ungrounded) — validate input, delegate to the service.
- **Defines:** `GenerationController` (class) · `.query(body): Promise<QueryResult>` · `.general(body): Promise<QueryResult>` · module-private `requireQuestion(body): string` (shared validation)
- **Depends on:** `GenerationService`
- **Used by:** `src/generation/generation.module.ts` (controller); route consumed by clients/UI

### `src/generation/generation.module.ts`
- **Purpose:** Generation feature module — imports `RetrievalModule`; binds `GENERATION_PROVIDER` via an env-selected factory (`GENERATION_PROVIDER` env: `anthropic` default | `openai-compatible`). Constructs the Anthropic client locally inside the `anthropic` branch only — no client is built when a different provider is selected.
- **Defines:** `GenerationModule` (class) · `GENERATION_PROVIDER` factory (`useFactory`)
- **Used by:** `src/app.module.ts`

### `src/retrieval/retrieval.service.ts`
- **Purpose:** Retrieval (RAG-20/23) — embed query → store cosine top-k → drop below min-score floor. Owns k + floor policy (config); returns `[]` to enable abstain (D5). Observes the top-hit (pre-floor) score to `rag_retrieval_score` (RAG-63e).
- **Defines:** `RetrievalService` (class) · `RetrievalService.retrieve(query): Promise<RetrievedChunk[]>` · `toNumber` (file-private)
- **Depends on:** `EMBEDDING_PROVIDER` (injected), `VECTOR_STORE` (injected), `ConfigService` (`RETRIEVAL_K`/`MIN_SCORE`), `MetricsService` (`@Optional`, RAG-63e)
- **Used by:** `src/retrieval/retrieval.module.ts`; consumed by generation (RAG-27)

### `src/retrieval/retrieval.module.ts`
- **Purpose:** Retrieval feature module — provides + exports `RetrievalService` (no controller; reached via `/query`).
- **Defines:** `RetrievalModule` (class)
- **Used by:** `src/app.module.ts`

### `src/ingestion/ingestion.service.ts`
- **Purpose:** The ingestion pipeline (RAG-16) — `load → chunk → embed → upsert`; thin orchestrator over the loader + the two adapter interfaces. Records `rag_ingest_docs_total` / `rag_ingest_chunks_total` (RAG-63e).
- **Defines:** `IngestionService` (class) · `IngestionService.ingest(path): Promise<IngestStats>` · `IngestStats` (interface)
- **Depends on:** `DocumentLoader`, `EMBEDDING_PROVIDER` (injected), `VECTOR_STORE` (injected), `ConfigService` (`CHUNK_TOKENS`/`OVERLAP_TOKENS`), `chunk` (`./chunker`), `MetricsService` (`@Optional`, RAG-63e)
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
- **Used by:** `src/embedding/voyage-embedding.provider.ts` · `src/embedding/transformers-embedding.provider.ts` (both implement) · `src/embedding/embedding.module.ts` (binds token)

### `src/embedding/voyage-embedding.provider.ts`
- **Purpose:** Default `EmbeddingProvider` impl — Voyage (default `voyage-4-lite`, env `VOYAGE_MODEL`), 1024 dims pinned via `output_dimension`, via REST (no SDK). All Voyage-specific code contained here.
- **Defines:** `VoyageEmbeddingProvider` (class) · `VoyageEmbeddingProvider.embed(): Promise<number[][]>`
- **Depends on:** `EmbeddingProvider` (interface), `Logger`, global `fetch`; `VOYAGE_API_KEY` (ctor arg)
- **Used by:** `src/embedding/embedding.module.ts` (factory)

### `src/embedding/transformers-embedding.provider.ts`
- **Purpose:** Local, in-process `EmbeddingProvider` impl (RAG-56) — transformers.js (`@huggingface/transformers`) feature-extraction, mean-pooled + L2-normalized. No server, no key, no rate limit; the free/self-hostable alternative to Voyage. Default model `Xenova/bge-large-en-v1.5` (1024 dims → matches `VECTOR(1024)`, no migration). Pipeline lazy-loaded once and cached; an injectable `PipelineLoader` keeps the heavy ESM package out of module load and out of unit tests. `defaultLoader` honours `TRANSFORMERS_CACHE` (→ `env.cacheDir`) so the weight cache can move off the read-only `node_modules` path in the distroless container (RAG-67 key-free run).
- **Defines:** `TransformersEmbeddingProvider` (class, `dims=1024`) · `TransformersEmbeddingProvider.embed(): Promise<number[][]>` · `FeatureExtractor` / `PipelineLoader` (types)
- **Depends on:** `EmbeddingProvider` (interface), `Logger`, `@huggingface/transformers` (dynamic `import`); `EMBEDDING_MODEL` (ctor arg, optional); `TRANSFORMERS_CACHE` (env, optional)
- **Used by:** `src/embedding/embedding.module.ts` (factory, `case 'transformers'`)

### `src/embedding/embedding.module.ts`
- **Purpose:** Global module — binds `EMBEDDING_PROVIDER` token to the impl selected by `EMBEDDING_PROVIDER` env (factory, RAG-11).
- **Defines:** `EmbeddingModule` (class, `@Global`) · provider factory (`useFactory` → `EMBEDDING_PROVIDER`: `voyage` → `VoyageEmbeddingProvider` | `transformers` → `TransformersEmbeddingProvider`)
- **Exports:** `EMBEDDING_PROVIDER`
- **Depends on:** `ConfigService`, `VoyageEmbeddingProvider`, `TransformersEmbeddingProvider`
- **Used by:** `src/app.module.ts` (import); token injected by ingestion/retrieval in later milestones

### `src/database/database.module.ts`
- **Purpose:** Global Postgres connection pool (the `VectorStore` seam will attach here in GO-21b).
- **Defines:** `PG_POOL` (DI token, const) · `DatabaseModule` (class, `@Global`) · pool factory (`useFactory` → `new Pool({ connectionString: DATABASE_URL })`)
- **Exports:** `PG_POOL`
- **Depends on:** `ConfigService`, `Pool` (`pg`)
- **Used by:** `src/app.module.ts` (import) · `src/health/health.controller.ts` (injects `PG_POOL`)

### `src/database/migrate.ts`
- **Purpose:** Standalone schema migration runner (RAG-46) — the single schema authority, replacing the initdb-only bootstrap. Applies every pending `db/migrations/*.sql` in lexicographic order, each in its own transaction (DDL + ledger insert commit atomically), tracking applied versions in the `schema_migrations` ledger. Idempotent. Run via `npm run migrate` (`node dist/database/migrate.js`), the compose `migrate` one-shot service, or a k8s Job/init-container (RAG-64). No NestFactory — a plain `pg` `Pool` reading `DATABASE_URL`.
- **Defines:** `MIGRATIONS_TABLE` (const) · `migrationsDir(): string` (env `MIGRATIONS_DIR` override) · `Migration` (interface) · `readMigrations(dir): Migration[]` · `pendingMigrations(all, applied): Migration[]` · `migrate(pool, logger): Promise<Migration[]>` · `main()` (guarded by `require.main === module`)
- **Depends on:** `Pool` (`pg`), `Logger` (`@nestjs/common`), `node:fs` · reads `db/migrations/*.sql`
- **Used by:** — (entrypoint; `npm run migrate` · compose `migrate` service) · unit test `src/database/migrate.spec.ts`

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

### `src/observability/correlation.als.ts`
- **Purpose:** Request-scoped correlation context (RAG-63b) — one id propagated across the async call chain (ingest → retrieve → generate) via `AsyncLocalStorage`, no signature threading. OTel-span-context swap seam (guide §6).
- **Defines:** `correlationStorage` (`AsyncLocalStorage<CorrelationStore>`) · `runWithCorrelation<T>(fn, correlationId?): T` · `getCorrelationId(): string | undefined` · `CorrelationStore` (interface)
- **Depends on:** `node:async_hooks`, `node:crypto` (`randomUUID`)
- **Used by:** `src/observability/correlation.middleware.ts` (HTTP scope); (RAG-63c correlated logger + RAG-63g CLI will consume `getCorrelationId`/`runWithCorrelation`)

### `src/observability/correlation.middleware.ts`
- **Purpose:** HTTP correlation middleware (RAG-63b) — honours inbound `x-request-id` else mints `randomUUID()`, echoes it on the response header, runs the request inside the ALS scope. Middleware (not interceptor) so it wraps the whole lifecycle incl. the RAG-63f exception filter.
- **Defines:** `CorrelationMiddleware` (class, `NestMiddleware`) · `CorrelationMiddleware.use(req, res, next)`
- **Depends on:** `correlationStorage` (`./correlation.als`), `node:crypto` (`randomUUID`)
- **Used by:** `src/observability/observability.module.ts` (applied `forRoutes('*')`)

### `src/observability/observability.module.ts`
- **Purpose:** Global (`@Global`) observability module (RAG-63) — one home for tracing/metrics/error-surfacing wiring, isolating it from feature code. Applies `CorrelationMiddleware` (RAG-63b), registers `MetricsController`, the global `HttpMetricsInterceptor` (`APP_INTERCEPTOR`, RAG-63d) and the global `AllExceptionsFilter` (`APP_FILTER`, RAG-63f), and exports `MetricsService` so feature services can add domain metrics (RAG-63e).
- **Defines:** `ObservabilityModule` (class, `@Global` `NestModule`) · `configure(consumer)` (applies `CorrelationMiddleware` to all routes)
- **Depends on:** `CorrelationMiddleware`, `MetricsService`, `MetricsController`, `HttpMetricsInterceptor`, `AllExceptionsFilter`, `APP_INTERCEPTOR`/`APP_FILTER` (`@nestjs/core`)
- **Exports:** `MetricsService`
- **Used by:** `src/app.module.ts`

### `src/observability/metrics.service.ts`
- **Purpose:** Owns the prom-client `Registry` + instruments (RAG-63d/e). Dedicated registry (not the global default) so instruments never collide across app/test instances. `METRICS_ENABLED` (default true) gates the `/metrics` route + default collectors; `collectDefaultMetrics` runs in `onModuleInit` (not the ctor) so unit tests stay handle-free. Feature services record the domain series via the `record*`/`observe*` methods.
- **Defines:** `MetricsService` (class, `OnModuleInit`) · `QueryOutcome` (type: `grounded`\|`abstained`\|`general`) · `registry` · `enabled` · HTTP: `httpRequests` (Counter) / `httpDuration` (Histogram) · domain (RAG-63e): `ingestDocs`/`ingestChunks` (Counter), `retrievalScore` (Histogram), `queryTotal` (Counter), `generationDuration` (Histogram) · errors (RAG-63f): `errors` (Counter) · methods `recordIngest`/`observeRetrievalScore`/`recordQuery`/`observeGeneration`/`recordError` · `onModuleInit()` · `render(): Promise<string>`
- **Depends on:** `ConfigService`, `prom-client` (`Counter`/`Histogram`/`Registry`/`collectDefaultMetrics`)
- **Used by:** `src/observability/metrics.controller.ts`, `src/observability/http-metrics.interceptor.ts`, `src/observability/all-exceptions.filter.ts`, `src/ingestion/ingestion.service.ts`, `src/retrieval/retrieval.service.ts`, `src/generation/generation.service.ts`

### `src/observability/metrics.controller.ts`
- **Purpose:** `GET /metrics` — Prometheus scrape endpoint (RAG-63d), mirrors `/healthz`. Thin: delegates to `MetricsService.render()`; 404s when `METRICS_ENABLED=false`.
- **Defines:** `MetricsController` (class) · `MetricsController.scrape(): Promise<string>` · `PROMETHEUS_CONTENT_TYPE` (const)
- **Depends on:** `MetricsService`
- **Used by:** `src/observability/observability.module.ts` (controller); route consumed by a Prometheus scraper

### `src/observability/http-metrics.interceptor.ts`
- **Purpose:** Records `rag_http_requests_total` + `rag_http_request_duration_seconds` per controller request (RAG-63d). Interceptor (not middleware) so `route` is the templated path and static assets never reach it. Records on the response `finish` event so status is the final code.
- **Defines:** `HttpMetricsInterceptor` (class, `NestInterceptor`) · `intercept(context, next)`
- **Depends on:** `MetricsService`, `rxjs` (`Observable`)
- **Used by:** `src/observability/observability.module.ts` (global `APP_INTERCEPTOR`)

### `src/observability/correlated-logger.ts`
- **Purpose:** `ConsoleLogger` that prefixes each line with the ALS correlation id (RAG-63c). Registered via `app.useLogger()` so the existing RAG-42 `new Logger(name)` call sites become correlated with zero changes. No id / non-string message → passed through unchanged. Optional `forcedStream` pins all output to one stream — the CLI passes `'stderr'` (RAG-63g) so stdout stays a clean, pipeable result; the HTTP app leaves it unset (normal stdout/stderr split).
- **Defines:** `CorrelatedLogger` (class, extends `ConsoleLogger`) · `constructor(forcedStream?)` · overrides `log`/`error`/`warn`/`debug`/`verbose` + `printMessages` (stream override) · `withCorrelation(message)` (private)
- **Depends on:** `getCorrelationId` (`./correlation.als`), `ConsoleLogger`/`LogLevel` (`@nestjs/common`)
- **Used by:** `src/main.ts` (`app.useLogger`, stdout) · `src/cli/main.ts` (`app.useLogger('stderr')`)

### `src/observability/all-exceptions.filter.ts`
- **Purpose:** Global exception filter — error surfacing (RAG-63f). Stamps the correlation id (header + body) on failures; counts only genuine server faults (`status >= 500` → `rag_errors_total{type}` + stack log). Preserves an `HttpException`'s intentional payload (`/healthz` flags, validation messages), enriching it with `correlationId`; an unexpected error gets a generic 500 body that never leaks internals. 4xx + abstain are never counted.
- **Defines:** `AllExceptionsFilter` (class, `@Catch()` `ExceptionFilter`) · `catch(exception, host)`
- **Depends on:** `getCorrelationId` (`./correlation.als`), `MetricsService`, `HttpException`/`Logger` (`@nestjs/common`)
- **Used by:** `src/observability/observability.module.ts` (global `APP_FILTER`)

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
| `migrate` | function | `src/database/migrate.ts` | self (entrypoint) · `src/database/migrate.spec.ts` |
| `readMigrations` / `pendingMigrations` | function | `src/database/migrate.ts` | `src/database/migrate.spec.ts` |
| `EmbeddingProvider` | interface | `src/embedding/embedding-provider.interface.ts` | voyage + transformers providers, embedding module, ingestion, retrieval |
| `EMBEDDING_PROVIDER` | DI token | `src/embedding/embedding-provider.interface.ts` | `src/embedding/embedding.module.ts` |
| `VoyageEmbeddingProvider` | class | `src/embedding/voyage-embedding.provider.ts` | `src/embedding/embedding.module.ts` |
| `TransformersEmbeddingProvider` | class | `src/embedding/transformers-embedding.provider.ts` | `src/embedding/embedding.module.ts` |
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
| `correlationStorage` | const (`AsyncLocalStorage`) | `src/observability/correlation.als.ts` | `src/observability/correlation.middleware.ts` |
| `runWithCorrelation` | function | `src/observability/correlation.als.ts` | (RAG-63g CLI) · `correlation.spec.ts` |
| `getCorrelationId` | function | `src/observability/correlation.als.ts` | (RAG-63c logger) · `correlation.spec.ts` |
| `CorrelationStore` | interface | `src/observability/correlation.als.ts` | `src/observability/correlation.als.ts` (ALS type) |
| `CorrelationMiddleware` | class | `src/observability/correlation.middleware.ts` | `src/observability/observability.module.ts` |
| `ObservabilityModule` | class | `src/observability/observability.module.ts` | `src/app.module.ts` |
| `MetricsService` | class | `src/observability/metrics.service.ts` | metrics controller + http interceptor; observability module (exported); ingestion/retrieval/generation services (`@Optional`, RAG-63e) |
| `QueryOutcome` | type | `src/observability/metrics.service.ts` | `src/generation/generation.service.ts` (via `recordQuery`) |
| `MetricsController` | class | `src/observability/metrics.controller.ts` | `src/observability/observability.module.ts` |
| `MetricsController.scrape` | method | `src/observability/metrics.controller.ts` | route `GET /metrics` |
| `HttpMetricsInterceptor` | class | `src/observability/http-metrics.interceptor.ts` | `src/observability/observability.module.ts` (global `APP_INTERCEPTOR`) |
| `CorrelatedLogger` | class | `src/observability/correlated-logger.ts` | `src/main.ts` (`app.useLogger`) · `src/cli/main.ts` (stderr) |
| `AllExceptionsFilter` | class | `src/observability/all-exceptions.filter.ts` | `src/observability/observability.module.ts` (global `APP_FILTER`) |
| `computeMetrics` | function | `eval/metrics.ts` | `eval/run-eval.ts`, `eval/metrics.spec.ts` |
| `computeAbstain` | function | `eval/metrics.ts` | `eval/run-eval.ts`, `eval/metrics.spec.ts` |
| `formatTable` | function | `eval/metrics.ts` | `eval/run-eval.ts`, `eval/metrics.spec.ts` |
| `EvalEntry` / `EvalResult` | interface | `eval/metrics.ts` | `eval/run-eval.ts`, `eval/probe-scores.ts` |

## HTTP routes

| Method | Path | Handler | File |
|--------|------|---------|------|
| GET | `/healthz` | `HealthController.check` | `src/health/health.controller.ts` |
| GET | `/metrics` | `MetricsController.scrape` | `src/observability/metrics.controller.ts` (404 when `METRICS_ENABLED=false`) |
| POST | `/ingest` | `IngestionController.ingest` | `src/ingestion/ingestion.controller.ts` |
| POST | `/query` | `GenerationController.query` | `src/generation/generation.controller.ts` |
| POST | `/query/general` | `GenerationController.general` | `src/generation/generation.controller.ts` |

## Env vars → read in

| Var | Read in | Default |
|-----|---------|---------|
| `PORT` | `src/main.ts` | 3000 |
| `METRICS_ENABLED` | `src/observability/metrics.service.ts` (gates `/metrics` route + default collectors) | true |
| `DATABASE_URL` | `src/database/database.module.ts` · `src/database/migrate.ts` (migration runner) | — |
| `MIGRATIONS_DIR` | `src/database/migrate.ts` (override migrations dir) | `<app>/db/migrations` (relative to `dist/database`) |
| `ANTHROPIC_API_KEY` | `src/generation/generation.module.ts` (factory, `anthropic` branch only) | — |
| `GENERATION_PROVIDER` | `src/generation/generation.module.ts` (factory selection) | anthropic |
| `GENERATION_MODEL` | `src/generation/generation.module.ts` (factory → provider ctor) | claude-opus-4-8 (anthropic) |
| `GENERATION_BASE_URL` | `src/generation/generation.module.ts` (factory, `openai-compatible` branch only) | — |
| `GENERATION_API_KEY` | `src/generation/generation.module.ts` (factory, `openai-compatible` branch only) | — |
| `VOYAGE_API_KEY` | `src/embedding/embedding.module.ts` (→ `VoyageEmbeddingProvider`) | — |
| `VOYAGE_MODEL` | `src/embedding/embedding.module.ts` (→ `VoyageEmbeddingProvider` ctor) | voyage-4-lite |
| `EMBEDDING_PROVIDER` | `src/embedding/embedding.module.ts` (factory selection) | voyage (or transformers) |
| `EMBEDDING_MODEL` | `src/embedding/embedding.module.ts` (→ `TransformersEmbeddingProvider` ctor) | Xenova/bge-large-en-v1.5 |
| `TRANSFORMERS_CACHE` | `src/embedding/transformers-embedding.provider.ts` (`defaultLoader` → `env.cacheDir`, when set) | transformers.js default (node_modules); Dockerfile sets `/hf-cache` |
| `RETRIEVAL_K` | `src/retrieval/retrieval.service.ts` · `eval/run-eval.ts` (table label) | 5 |
| `MIN_SCORE` | `src/retrieval/retrieval.service.ts` | 0.3 (Voyage, RAG-57); 0.59 for bge-large (RAG-56f) |
| `CHUNK_TOKENS` | `src/ingestion/ingestion.service.ts` (default in `DEFAULT_CHUNK_OPTIONS`) | 512 |
| `OVERLAP_TOKENS` | `src/ingestion/ingestion.service.ts` (default in `DEFAULT_CHUNK_OPTIONS`) | 64 |
| `EVAL_MIN_HIT_RATE` | `eval/run-eval.ts` (CI gate: exit 1 below floor) | 0.5 |
| `EVAL_MIN_ABSTAIN_RATE` | `eval/run-eval.ts` (CI gate: exit 1 below floor) | 0.5 |

## Non-code assets (referenced by build/runtime)

| File | Consumed by | Purpose |
|------|-------------|---------|
| `db/migrations/001_init.sql` | `src/database/migrate.ts` (migration runner, RAG-46) | `vector` extension + `chunks` table + HNSW index (first migration; single schema authority) |
| `docker-compose.yml` | `docker compose up` | db + migrate (one-shot) + ollama + seed + app services |
| `Dockerfile` | `docker-compose.yml` (app build) | build/run the Nest app |
| `eval/dataset.jsonl` | `eval/run-eval.ts` · `eval/probe-scores.ts` | labeled eval set (`question` → `relevant_doc_ids[]`; empty = should abstain) |
| `eval/sample-corpus/` | `POST /ingest` before an eval run | **frozen** fixture corpus the dataset labels are tied to (rule `evals.md`) |
| `tsconfig.eval.json` | `npm run eval` (ts-node `--project`) · typecheck hook | extends root tsconfig, adds `eval/**` (kept out of `nest build`) |
| `jest.config.js` | `npm test` | ts-jest; roots `src/` + `eval/` |
