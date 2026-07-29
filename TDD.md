# TDD — RAG Knowledge-Store Chat

> Technical Design. The "how". Requirements in `PRD.md`; build order in `GO-21.md`.

## 1. Architecture

```
                ┌────────── NestJS API (TypeScript) ──────────┐
  Browser ──▶   │  /ingest   /query                            │
  (chat UI)     │     │          │                             │
                │     ▼          ▼                             │
                │  Ingestion   Retrieval ──▶ Generation        │
                │  pipeline    (pgvector)    (Claude)          │
                └─────┼───────────┼──────────────┼─────────────┘
                      ▼           ▼               ▼
              Embedding     Postgres +     @anthropic-ai/sdk
               adapter       pgvector       claude-opus-4-8
              (Voyage)        (HNSW)        + citations
```

All components run in Docker Compose: `app` (NestJS) + `db` (Postgres w/ `vector` extension).

## 2. Components

### 2.1 Embedding adapter (FR-2)
Interface — the provider swap point (no vendor lock-in):
```ts
interface EmbeddingProvider {
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}
```
- Default impl: `VoyageEmbeddingProvider` (default `voyage-4-lite`, override via `VOYAGE_MODEL`; dims pinned to 1024 via `output_dimension`).
- Alt impl (to prove the seam): `OpenAIEmbeddingProvider` or a local model. Selected via `EMBEDDING_PROVIDER` env.

### 2.2 Vector store (FR-1, FR-3)
- Postgres + **pgvector**, HNSW index. Chosen over Pinecone/Qdrant: no extra service, transactional, fits 1–10M vectors, standard SQL tooling.
- Behind a `VectorStore` interface (`upsert`, `search`) so pgvector is swappable too.

**Schema**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE chunks (
  id          BIGSERIAL PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  source      TEXT NOT NULL,          -- filename / URL
  chunk_index INT  NOT NULL,
  content     TEXT NOT NULL,
  embedding   VECTOR(1024) NOT NULL,  -- match adapter dims
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(doc_id, chunk_index)         -- idempotent re-ingest
);
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
```

### 2.3 Ingestion pipeline (FR-1)
`load files → chunk (token-aware, overlap) → embed (adapter) → upsert (vector store)`. Idempotent via the `UNIQUE(doc_id, chunk_index)` upsert. Structured log per doc (chunks, ms).

### 2.4 Retrieval (FR-3)
`embed(query) → pgvector cosine search top-k → return {content, source, score}`. `k` and a min-score floor are config.

### 2.5 Generation (FR-4)
Behind a `GenerationProvider` interface — the same swap-point discipline as 2.1–2.2:
```ts
interface GenerationProvider {
  readonly supportsCitations: boolean;
  generate(question: string, chunks: RetrievedChunk[]): Promise<{ answer: string; citations: Citation[] }>;
}
```
- Default impl: `AnthropicGenerationProvider` (`@anthropic-ai/sdk`, model **`claude-opus-4-8`**). Retrieved chunks go in as `document` content blocks with `citations: {enabled: true}`; the response carries cited spans mapped back to source chunks (`supportsCitations = true`). Render citations in the UI.
- Alt impl (proves the seam): `OpenAICompatibleGenerationProvider` — any OpenAI-compatible chat-completions endpoint (OpenAI itself, or a self-hosted server: Ollama, LM Studio, vLLM), selected via `GENERATION_PROVIDER=openai-compatible` + `GENERATION_BASE_URL` + `GENERATION_MODEL`. No native citations exist on that surface, so `supportsCitations = false` and citations are always `[]` — **never prompt-engineered as a substitute** (D4 update).
- If retrieval returns nothing above the floor → **abstain** ("I don't have that in the corpus"), never free-generate. This is policy, not mechanism: it lives in `GenerationService` above the provider (mirroring 2.4's store/floor split), so every provider gets the guarantee for free and never sees an empty chunk list.

### 2.6 API (FR-1, FR-3, FR-5)
- `POST /ingest` — `{ path }` → ingestion stats.
- `POST /query` — `{ question, k? }` → `{ answer, citations[], chunks[] }`.
- `GET /healthz` — liveness for the one-command-run check.

### 2.7 Chat UI (FR-5)
Single static page (or minimal React) hitting `/query`; renders answer + clickable citations. Polish is explicitly out of scope.

### 2.8 Eval harness (FR-6) — the quality gate
- `eval/dataset.jsonl`: `{ question, relevant_doc_ids[] }`.
- `npm run eval`: runs retrieval over each question, computes **hit-rate** and **precision@k**, prints a table + summary number.
- This number goes in the README. Treat it as a first-class deliverable, not an afterthought.

## 3. Cross-cutting (NFRs)

- **Config:** `@nestjs/config`; `.env.example` committed, `.env` git-ignored. Keys: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `VOYAGE_MODEL`, `DATABASE_URL`, `EMBEDDING_PROVIDER`, `RETRIEVAL_K`, `MIN_SCORE`.
- **Logging:** structured (pino/Nest logger) on ingest + query; latency + counts.
- **Secrets:** env only — never committed, never in prompts/logs.
- **Tests:** Jest. Unit-test chunking + adapters; integration-test `/query` happy path.

## 4. Deployment (FR-7)

- `docker-compose.yml`: `db` (pgvector image) + a one-shot `migrate` service + `app`. `docker compose up` → migrations run → API on a fixed port.
- **Migration runner (RAG-46):** `src/database/migrate.ts` (`npm run migrate` / `dist/database/migrate.js`) applies every pending `db/migrations/*.sql` in order, each transactionally, tracking applied versions in a `schema_migrations` ledger. Idempotent and the single schema authority — it replaces the initdb-only bootstrap, which never re-ran on existing volumes and didn't cover managed Postgres. Runs as a step before the app (compose `migrate` service; a k8s Job/init-container for RAG-64). Migrations are the append-only `db/migrations/00X_<change>.sql` files (see the `db-migration` skill; mind the pgvector dims trap).
- Public URL (GO-21f): a container host (Fly.io / Render / Railway) + managed Postgres-with-pgvector, or a small VM.

## 5. Build order

Milestones GO-21a→g in `GO-21.md`. Adapter interfaces (2.1, 2.2) land in GO-21a/b so the seams exist from the start.
