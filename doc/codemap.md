# Code Map

> Index of files → exported symbols → where each is used. Its purpose: when a function or symbol needs to change, look it up here to see **every place affected** before editing.
>
> **Maintenance:** update after any code change — use the `codemap` skill (or dispatch the `codemap-updater` agent). Keep the "Last updated" line and the indexes in sync with `src/`.
>
> **Last updated:** GO-21b — embedding adapter (RAG-9/10/11), vector-store seam (RAG-12/13), loader + chunker (RAG-14/15).

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
- **Imports:** `ConfigModule.forRoot({ isGlobal: true })`, `DatabaseModule`, `EmbeddingModule`, `VectorStoreModule`, `HealthModule`
- **Used by:** `src/main.ts`

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
- **Defines:** `VectorStore` (interface: `upsert`; `search` added at RAG-21) · `ChunkInput` (interface) · `VECTOR_STORE` (DI token, const)
- **Used by:** `src/vector-store/pgvector.store.ts` (implements) · `src/vector-store/vector-store.module.ts` (binds token)

### `src/vector-store/pgvector.store.ts`
- **Purpose:** Postgres + pgvector impl — idempotent batch `upsert` (ON CONFLICT on `(doc_id, chunk_index)`). All SQL/pgvector specifics contained here.
- **Defines:** `PgVectorStore` (class) · `PgVectorStore.upsert(): Promise<number>`
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
- **Purpose:** Default `EmbeddingProvider` impl — Voyage `voyage-3`, 1024 dims, via REST (no SDK). All Voyage-specific code contained here.
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
| `DocumentLoader` | class | `src/ingestion/document-loader.ts` | ingestion service (RAG-16) |
| `LoadedDocument` | interface | `src/ingestion/document-loader.ts` | ingestion service (RAG-16) |
| `chunk` | function | `src/ingestion/chunker.ts` | ingestion service (RAG-16) |
| `TextChunk` | interface | `src/ingestion/chunker.ts` | ingestion service (RAG-16) |
| `ChunkOptions` / `DEFAULT_CHUNK_OPTIONS` | interface/const | `src/ingestion/chunker.ts` | chunker, ingestion config (RAG-16) |
| `countTokens` / `splitByTokens` / `tailByTokens` | functions | `src/ingestion/tokenizer.ts` | `src/ingestion/chunker.ts` |
| `HealthModule` | class | `src/health/health.module.ts` | `src/app.module.ts` |
| `HealthController` | class | `src/health/health.controller.ts` | `src/health/health.module.ts` |
| `HealthController.check` | method | `src/health/health.controller.ts` | route `GET /healthz` |
| `HealthReport` | interface | `src/health/health.controller.ts` | `src/health/health.controller.ts` (return type) |

## HTTP routes

| Method | Path | Handler | File |
|--------|------|---------|------|
| GET | `/healthz` | `HealthController.check` | `src/health/health.controller.ts` |

## Env vars → read in

| Var | Read in | Default |
|-----|---------|---------|
| `PORT` | `src/main.ts` | 3000 |
| `DATABASE_URL` | `src/database/database.module.ts` | — |
| `ANTHROPIC_API_KEY` | _(reserved — GO-21d generation)_ | — |
| `VOYAGE_API_KEY` | `src/embedding/embedding.module.ts` (→ `VoyageEmbeddingProvider`) | — |
| `EMBEDDING_PROVIDER` | `src/embedding/embedding.module.ts` (factory selection) | voyage |
| `RETRIEVAL_K` | _(reserved — GO-21c retrieval)_ | 5 |
| `MIN_SCORE` | _(reserved — GO-21c floor)_ | 0.2 |
| `CHUNK_TOKENS` | _(read by ingestion service at RAG-16; default in `DEFAULT_CHUNK_OPTIONS`)_ | 512 |
| `OVERLAP_TOKENS` | _(read by ingestion service at RAG-16; default in `DEFAULT_CHUNK_OPTIONS`)_ | 64 |

## Non-code assets (referenced by build/runtime)

| File | Consumed by | Purpose |
|------|-------------|---------|
| `db/init/001_init.sql` | `docker-compose.yml` (db initdb mount) | `vector` extension + `chunks` table + HNSW index |
| `docker-compose.yml` | `docker compose up` | app + pgvector services |
| `Dockerfile` | `docker-compose.yml` (app build) | build/run the Nest app |
