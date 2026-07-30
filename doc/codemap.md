# Code Map

> Index of files → exported symbols → where each is used. Its purpose: when a function or symbol needs to change, look it up here to see **every place affected** before editing.
>
> **Maintenance:** update after any code change — use the `codemap` skill (or dispatch the `codemap-updater` agent). Keep the "Last updated" line and the indexes in sync with `src/` and `eval/`.
>
> **Last updated:** RAG-66d `rag init` scaffold writer — new `src/cli/init.ts` (`scaffoldFiles()` pure file-set data + `runInit()` fs orchestrator: idempotent skip-existing, `--force`, `--dry-run`) and `formatInitResult` in `src/cli/format.ts`; third `commander` subcommand in `src/cli/main.ts` (no app-context bootstrap — file-writing only). Writes `src/rag/rag.module.ts` (host wiring importing `RagModule` from the package), `.env.rag.example`, `docker-compose.rag.yml` (standalone pgvector on port 5433), `db/rag/001_init.sql` (documents reusing the shipped migration runner via `MIGRATIONS_DIR` env override). Live-smoke-verified: `node dist/cli/main.js init` and `npx rag init` both scaffold; re-run skips; `--force` overwrites; `--dry-run` writes nothing; generated compose YAML validates. Prior: RAG-66c typed `forRoot(options)` override surface — `RagModuleOptions` (`embeddingProvider`/`generationProvider`/`k`/`minScore`/`http`); `EmbeddingModule`/`GenerationModule`/`IngestionModule`/`RetrievalModule` each gained a `register()` static (the override-aware path) alongside their existing decorator-based default. `GenerationModule`/`IngestionModule` decorators had `imports`/`controllers` **removed** (moved into `register()` only) — Nest concatenates a class's static `@Module()` metadata with a `DynamicModule`'s own `imports`/`controllers` rather than replacing them, so a decorator-level `imports:[RetrievalModule]` silently fought `register()`'s override-aware import (see `generation.module.ts` doc comment); `providers` concatenation is safe (token-keyed, last wins) so that pattern was kept for `embeddingProvider`/`generationProvider`. `AppModule` now wires `IngestionModule.register({http:true})` / `GenerationModule.register({http:true})` (its own bare `RetrievalModule` import removed as redundant) — `register()` is the single source of truth for both the standalone app and the embedded surface. `RetrievalService` gained an `@Optional` `RAG_RETRIEVAL_OPTIONS` token (k/minScore override, env-fallback unchanged). Prior: RAG-66b embeddable surface — `src/index.ts` barrel + `src/rag.module.ts` (`RagModule.forRoot()`), `package.json` importable (`private:false`, `main`/`types`/`exports`/`files`), `tsconfig` `declaration:true`.

---

## Files

### `src/index.ts`
- **Purpose:** Public library barrel (GO-21j / RAG-66b) — the supported API surface for embedding RAG into a host project. Nothing outside this file is part of the package's public API; the `rag init` generator (RAG-66d) writes host wiring that imports from here.
- **Re-exports:** `RagModule` (`./rag.module`) · `IngestionService`/`RetrievalService`/`GenerationService` + `QueryResult` type · adapter seams + tokens: `EMBEDDING_PROVIDER`+`EmbeddingProvider`, `VECTOR_STORE`+`VectorStore`/`ChunkInput`/`RetrievedChunk`, `GENERATION_PROVIDER`+`GenerationProvider`/`Citation`/`GenerationOutput`
- **Used by:** package consumers via `main`/`types`/`exports` → `dist/index.js` (host `import { RagModule } from 'rag-knowledge-store'`)

### `src/rag.module.ts`
- **Purpose:** The embeddable entry point (GO-21j / RAG-66b/c) — a host adds one import, `RagModule.forRoot(options)`, and gets the whole pipeline. Composes the existing feature modules' `register()` statics and re-exports the two top-level ones; re-implements nothing. Env-first — every option is an independent, optional override.
- **Defines:** `RagModule` (class) · `RagModule.forRoot(options?: RagModuleOptions): DynamicModule` · `RagModuleOptions` (interface: `embeddingProvider`, `generationProvider`, `k`, `minScore`, `http`)
- **Imports (in forRoot):** `ConfigModule.forRoot({ isGlobal: true })`, `DatabaseModule`, `EmbeddingModule.register(options.embeddingProvider)`, `VectorStoreModule`, `IngestionModule.register({http})`, `GenerationModule.register({generationProvider, http, retrieval:{k,minScore}})` — the `ingestionModule`/`generationModule` `DynamicModule` values are captured once and **exported by that same reference** (not the bare classes), so the re-export resolves against the exact configured instance
- **Used by:** `src/index.ts` (barrel); a host `AppModule` (via the generated `src/rag/rag.module.ts`, RAG-66d)

### `src/main.ts`
- **Purpose:** App entrypoint — bootstraps Nest, serves the built React chat UI (`useStaticAssets` → `../web/dist`, same origin as `/query`; GO-21e-g/RAG-33), reads `PORT`, starts the HTTP server.
- **Defines:** `bootstrap(): Promise<void>`
- **Depends on:** `AppModule` (`./app.module`), `ConfigService` (`@nestjs/config`), `NestFactory`, `NestExpressApplication` (`@nestjs/platform-express`), `join` (`path`), `Logger`, `CorrelatedLogger` (`./observability/correlated-logger`, via `app.useLogger` — RAG-63c)
- **Used by:** — (entrypoint; self-invoked via `void bootstrap()`)
- **Serves:** `web/dist/` — the built React chat UI (Vite), same origin as `/query` (GO-21e-g). Built by the `web-build` Dockerfile stage (`vite build` → `/web/dist`) and copied into the image (`COPY --from=web-build /web/dist ./web/dist`). The legacy vanilla `web/public/` prototype is no longer served or mounted.

### `web/` — chat UI (React 18 + Vite + TS, GO-21e)
Separate npm package (`web/package.json`, own `node_modules`/lockfile), scaffolded in GO-21e-b. Dev server proxies `/query` (+ `/query/general`), `/healthz`, `/metrics` → Nest (`vite.config.ts`, `publicDir:false` so it doesn't claim the legacy `web/public/` prototype). GO-21e-c added the design-token system + `AppShell`; the four render branches (Conversation/AnswerBody/SourcesPanel/state cards) land in GO-21e-d…f.
- **`web/src/types.ts`** — `Citation`, `RetrievedChunk`, `QueryResult` — a mirror of `QueryResult` in `src/generation/generation.service.ts` (server is source of truth); keep in lockstep.
- **`web/src/api.ts`** — `fetchQuery(question, signal?): Promise<QueryResult>` (the only network surface) + `QueryError` (carries `status` + `correlationId` from the RAG-63 error body / `x-request-id`).
- **`web/src/state.ts`** — `AppState` (a `history: Exchange[]` newest-first + `activeId`) / `Exchange` / `Phase` / `Action` (`submit`/`retry`/`success`/`failure`/`select`/`newChat`/`remove`/`clear`) / `QueryError` + `reducer`, `init`, `phaseOf`, `activeExchange`, `loadHistory`/`saveHistory` — the query-flow reducer with **persisted question history** (localStorage `rag-history`, results only, capped 50); `retry` re-runs an exchange in place. Render branch is derived (`phaseOf(active)`), not stored. Used by `App.tsx`.
- **`web/src/hooks/useTheme.ts`** — `useTheme()` → `{theme, toggle}`; mirrors `data-theme` on `<html>` + persists to `localStorage` (`rag-theme`), defaulting to OS preference. Paired with the pre-paint script in `index.html`.
- **`web/src/lib/time.ts`** — `relativeTime(ts, now?)` — compact relative time for history items.
- **`web/src/App.tsx`** — `App` — composes `AppShell` + `HistoryDrawer` + (`EmptyState` | `Conversation`) around the reducer + `fetchQuery` (owns `historyOpen`, persists history via effect); `runQuery`/`submit`/`retry` drive the query flow.
- **`web/src/main.tsx`** — React root mount (imports `index.css` → `styles/tokens.css`).
- **`web/src/components/`** — `AppShell` (theme owner + 3-row grid: header/scroll/composer; threads history toggle to `Header`), `Header` (+ history burger), `StatusBadge` (`citationsSupported: boolean|null` → citations/no-citations/idle), `ThemeToggle`, `Composer` (autofocus, auto-grow, ⌘/Ctrl+Enter), `EmptyState` (intro + example-question chips), `HistoryDrawer` (GO-21e-i — collapsible left drawer: persisted past questions, select/new/remove/clear; overlay + Esc), `Conversation` (GO-21e-d/e — active exchange as user + assistant turn; autoscroll; branches to the honest states; `onRetry`), `Message` (user/assistant bubble), `AnswerBody` (renders answer text), `LoadingAnswer` (shimmer skeleton), `AbstainCard` (GO-21e-e — calm `--info` "not in the corpus", verbatim message), `CapabilityNote` (GO-21e-e — `--info`, shown when `!citationsSupported`, RAG-62), `ErrorState` (GO-21e-e — the only `--danger` state; retry + correlation id), `AnswerView` (GO-21e-f — orchestrates answer + citations + sources; owns citation→chunk highlight/expand state), `CitationList` (GO-21e-f — grouped numbered citations, Radix popover with `citedText`+source, click → activate chunk), `SourcesPanel` (GO-21e-f — collapsible `chunks[]`, "grounded ✓", scrolls/highlights on citation click), `ChunkRow` (GO-21e-f — `forwardRef`; source + cite markers + `ScoreBar` + snippet), `ScoreBar` (GO-21e-f — 0–1 similarity bar), `ErrorBoundary` (GO-21e-h — class boundary catching render faults in the conversation subtree). Each has a co-located `.css`; all colors/spacing reference tokens. `Message` sets `aria-live="polite"` on assistant turns (GO-21e-h). Token contrast tuned to WCAG AA in both themes (GO-21e-h: light `--text-muted`/`--success`, dark `--text-muted`).

### `src/app.module.ts`
- **Purpose:** Root module — wires global config + feature modules.
- **Defines:** `AppModule` (class)
- **Imports:** `ConfigModule.forRoot({ isGlobal: true })`, `ObservabilityModule`, `DatabaseModule`, `EmbeddingModule`, `VectorStoreModule`, `IngestionModule.register({http:true})`, `GenerationModule.register({http:true})`, `HealthModule` (RAG-66c: Ingestion/Generation go through `register()`, not the bare class — no separate `RetrievalModule` import needed, `GenerationModule.register()` supplies its own)
- **Used by:** `src/main.ts`

### `src/cli/main.ts`
- **Purpose:** The `rag` CLI entrypoint (GO-21h RAG-52; GO-21j RAG-66d) — commander program with `ingest <path>`, `query <question>`, and `init` subcommands. `ingest`/`query` bootstrap `NestFactory.createApplicationContext(AppModule, { logger: false })` silent, then attach `CorrelatedLogger` and run each command body in one ALS correlation scope (RAG-63g) so operational logs carry one id per invocation — no HTTP. `init` is deliberately **not** wrapped in `withApp` — it only writes files (no DB/adapter access needed), so it has no app-context/correlation cost. Registered as `bin: { "rag": "dist/cli/main.js" }`. Errors → stderr, exit 1.
- **Defines:** `withApp` (file-private helper — bootstraps, sets logger, wraps `fn` in `runWithCorrelation`) · commander `program` (self-executing) · `init` command options: `--target <dir>` (default cwd), `--force`, `--dry-run`
- **Depends on:** `AppModule`, `IngestionService`, `GenerationService`, `CorrelatedLogger` + `runWithCorrelation` (`../observability/*`), `randomUUID` (`node:crypto`), `formatIngestStats`/`formatInitResult`/`formatQueryResult` (`./format`), `runInit` (`./init`), `commander`
- **Used by:** — (entrypoint; invoked as `rag` / `node dist/cli/main.js`)

### `src/cli/init.ts`
- **Purpose:** The `rag init` scaffold generator (GO-21j / RAG-66d, `embeddable-scaffold-guide.md` §4) — writes wiring + config into a host project so it can `import { RagModule } from 'rag-knowledge-store'`. Never copies pipeline logic, only files that import the package (reuse discipline). `scaffoldFiles()` is pure data (no fs access) — the single source of truth for "what init writes," shared by the real write path and `--dry-run`'s preview.
- **Defines:** `scaffoldFiles(): ScaffoldFile[]` · `runInit(options: InitOptions): Promise<InitResult>` · `ScaffoldFile`/`InitOptions`/`InitResult`/`InitFileResult` (interfaces) · `FileOutcome` (type: `'written' | 'skipped' | 'would-write'`) · `pathExists` (file-private)
- **File set written:** `src/rag/rag.module.ts` (thin `HostRagModule` wrapping `RagModule.forRoot()`) · `.env.rag.example` · `docker-compose.rag.yml` (standalone pgvector, port 5433 to avoid colliding with a host's own Postgres) · `db/rag/001_init.sql` (the `chunks`/HNSW schema; documents applying it via the shipped migration runner's `MIGRATIONS_DIR` env override, or by hand)
- **Idempotency:** a file that exists is skipped unless `--force`; `--dry-run` performs the same per-file walk with zero filesystem writes (reports `'would-write'` instead of `'written'`, `'skipped'` still wins over dry-run when the file already exists)
- **Used by:** `src/cli/main.ts` (`init` command)

### `src/cli/format.ts`
- **Purpose:** Pure stdout formatting for the CLI (RAG-53/54, RAG-66d) — no Nest/DI (and, for init, no filesystem), unit-testable in isolation. Abstain answers pass through verbatim (D5); when a non-citation provider answered, prints an honest capability note instead of fabricated citations (RAG-62).
- **Defines:** `formatIngestStats(path, stats): string` · `formatQueryResult(result): string` · `formatInitResult(result, dryRun): string`
- **Depends on:** `IngestStats` (`../ingestion/ingestion.service`), `QueryResult` (`../generation/generation.service`), `InitResult` (`./init`) — types only
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
- **Purpose:** Generation feature module (RAG-66c). `@Module()` decorator carries **only** `GenerationService` + the default (env-only) `GENERATION_PROVIDER` factory — deliberately **no `imports`/`controllers`**, because Nest concatenates a class's static decorator metadata with a `DynamicModule`'s own `imports`/`controllers` rather than replacing them (confirmed via `@nestjs/core/scanner.js`'s `reflectImports`/`reflectControllers`); a decorator-level `imports:[RetrievalModule]` would sit alongside `register()`'s override-aware `RetrievalModule.register(options.retrieval)` as a second, differently-tokened instance, and DI would silently wire `GenerationService` to the wrong one (confirmed via a failing test before the fix — the decorator's plain-import instance won). `providers` concatenation is safe (Nest's provider map is keyed by token, last `.set()` wins) — that's what lets the `generationProvider` override on the *decorator-listed* `GENERATION_PROVIDER` factory work correctly. `register()` is therefore the **only** way this module is ever imported (`AppModule` included) — single source of truth.
- **Defines:** `GenerationModule` (class) · `GenerationModule.register(options?: GenerationModuleOptions): DynamicModule` · `GenerationModuleOptions` (interface: `generationProvider`, `http`, `retrieval`) · `resolveGenerationProvider(config, override?)` · `GenerationProviderName` (type: `'anthropic' | 'openai-compatible'`)
- **Used by:** `src/app.module.ts` (`.register({http:true})`), `src/rag.module.ts` (`.register({...})`, captured + re-exported by reference)

### `src/retrieval/retrieval.service.ts`
- **Purpose:** Retrieval (RAG-20/23) — embed query → store cosine top-k → drop below min-score floor. Owns k + floor policy; env-driven, with an optional `RAG_RETRIEVAL_OPTIONS` override (RAG-66c, `RagModule.forRoot({k, minScore})`) taking precedence when bound. Returns `[]` to enable abstain (D5). Observes the top-hit (pre-floor) score to `rag_retrieval_score` (RAG-63e).
- **Defines:** `RetrievalService` (class) · `RetrievalService.retrieve(query): Promise<RetrievedChunk[]>` · `RAG_RETRIEVAL_OPTIONS` (DI token) · `RagRetrievalOptions` (interface: `k`, `minScore`) · `toNumber` (file-private)
- **Depends on:** `EMBEDDING_PROVIDER` (injected), `VECTOR_STORE` (injected), `ConfigService` (`RETRIEVAL_K`/`MIN_SCORE` fallback), `MetricsService` (`@Optional`, RAG-63e), `RAG_RETRIEVAL_OPTIONS` (`@Optional`, RAG-66c — unbound in the standalone app's plain `RetrievalModule`, so behavior there is unchanged)
- **Used by:** `src/retrieval/retrieval.module.ts`; consumed by generation (RAG-27)

### `src/retrieval/retrieval.module.ts`
- **Purpose:** Retrieval feature module — provides + exports `RetrievalService` (no controller; reached via `/query`). `register(options)` (RAG-66c) additionally binds `RAG_RETRIEVAL_OPTIONS` when given — safe alongside the plain decorator usage since `providers` concatenation is token-keyed (no collision, unlike `imports`/`controllers`; see `generation.module.ts`).
- **Defines:** `RetrievalModule` (class) · `RetrievalModule.register(options?: RagRetrievalOptions): DynamicModule`
- **Used by:** `src/generation/generation.module.ts` (`.register()`, the sole importer — both the standalone app and `RagModule` reach `RetrievalService` through `GenerationModule`)

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
- **Purpose:** Ingestion feature module (RAG-66c). `@Module()` decorator carries `IngestionService`/`DocumentLoader` + `exports` only — deliberately **no `controllers`** (same `imports`/`controllers`-concatenation reasoning as `generation.module.ts`); `register()` is the only place `IngestionController` is registered, gated by the `http` option.
- **Defines:** `IngestionModule` (class) · `IngestionModule.register(options?: {http?: boolean}): DynamicModule`
- **Used by:** `src/app.module.ts` (`.register({http:true})`), `src/rag.module.ts` (`.register({http})`, captured + re-exported by reference)

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
- **Purpose:** Global module — binds `EMBEDDING_PROVIDER` token to the impl selected by `EMBEDDING_PROVIDER` env (factory, RAG-11). `register(override)` (RAG-66c) is the `RagModule.forRoot({embeddingProvider})` seam: a concrete `EmbeddingProvider` instance is used as-is, a name picks that impl, `undefined` falls back to env — same factory logic (`resolveEmbeddingProvider`) either way. The returned `DynamicModule` sets `global:true` explicitly — the class's own `@Global()` only applies to the plain (decorator) usage; a dynamically-returned module must opt back in for cross-module token visibility (Ingestion/Retrieval never import EmbeddingModule directly).
- **Defines:** `EmbeddingModule` (class, `@Global`) · `EmbeddingModule.register(override?: EmbeddingProviderName | EmbeddingProvider): DynamicModule` · `resolveEmbeddingProvider(config, override?)` · `EmbeddingProviderName` (type: `'voyage' | 'transformers'`)
- **Exports:** `EMBEDDING_PROVIDER`
- **Depends on:** `ConfigService`, `VoyageEmbeddingProvider`, `TransformersEmbeddingProvider`
- **Used by:** `src/app.module.ts` (plain import); `src/rag.module.ts` (`.register(options.embeddingProvider)`)

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
