# rag — task tracker

> Granular execution checklist derived from `PRD.md` (FR-*), `TDD.md` (§*), and the `GO-21.md` milestones. IDs are `RAG-<n>` (stable, never reused). Check items off as they land; keep this current — it's the project's working source of truth.
>
> Legend: `[x]` done · `[~]` scaffolded, not runtime-verified · `[ ]` todo

---

## Milestone GO-21a — Scaffold / one-command run  (PRD FR-7)

- [x] RAG-1 — NestJS + TypeScript project (`package.json`, `tsconfig`, `nest-cli`)  · TDD §1
- [x] RAG-2 — Global config via `@nestjs/config` (env-driven)  · TDD §3
- [x] RAG-3 — Postgres `pg` Pool as injectable `PG_POOL`  · TDD §2.2
- [x] RAG-4 — `db/init/001_init.sql`: `vector` extension + `chunks` table + HNSW index  · TDD §2.2
- [x] RAG-5 — `GET /healthz` (DB reachable + pgvector present → 200/503)  · TDD §2.6
- [x] RAG-6 — Dockerfile + `docker-compose.yml` (app + pgvector), `.dockerignore`  · TDD §4
- [x] RAG-7 — `.env.example` with all keys  · TDD §3
- [x] RAG-8 — **Runtime-verify**: `docker compose up` → `/healthz` returns `ok` (db+pgvector true)  · GO-21a done-when

## Milestone GO-21b — Ingestion pipeline + embedding adapter  (PRD FR-1, FR-2)

- [x] RAG-9 — `EmbeddingProvider` interface (`dims`, `embed()`)  · TDD §2.1
- [x] RAG-10 — `VoyageEmbeddingProvider` (default, `voyage-3`)  · TDD §2.1, D3
- [x] RAG-11 — Provider factory selected by `EMBEDDING_PROVIDER` env  · TDD §2.1
- [~] RAG-12 — `VectorStore` interface (`upsert`, `search`)  · TDD §2.2 — `upsert` defined; `search` added at RAG-21 (eval-gated)
- [x] RAG-13 — `PgVectorStore.upsert()` (idempotent on `UNIQUE(doc_id, chunk_index)`)  · TDD §2.2
- [~] RAG-14 — Document loader (md / txt / pdf)  · TDD §2.3 — md/txt done + tested; PDF deferred to its own slice (D9)
- [x] RAG-15 — Token-aware chunker with overlap  · TDD §2.3 — recursive structure-aware, eval-tunable (D9)
- [x] RAG-16 — Ingestion service: load → chunk → embed → upsert  · TDD §2.3
- [x] RAG-17 — `POST /ingest` ({ path } → stats)  · TDD §2.6
- [x] RAG-18 — Structured logs on ingest (docs, chunks, ms)  · TDD §3
- [~] RAG-19 — Verify re-ingest is idempotent (row count stable)  · TDD §2.3 — store-level ON CONFLICT unit-tested; live row-count check pending smoke-test (needs DB + key)

## Milestone GO-21c — Retrieval  (PRD FR-3)

- [ ] RAG-20 — Embed query via the configured adapter  · TDD §2.4
- [ ] RAG-21 — `PgVectorStore.search()`: cosine top-k over HNSW  · TDD §2.4
- [ ] RAG-22 — Min-score floor (config `MIN_SCORE`)  · TDD §2.4, D5
- [ ] RAG-23 — Retrieval service returns `{ content, source, score }[]`  · TDD §2.4
- [ ] RAG-24 — `RETRIEVAL_K` configurable  · TDD §3

## Milestone GO-21d — Generation with citations  (PRD FR-4)

- [ ] RAG-25 — Anthropic SDK client, model `claude-opus-4-8`  · TDD §2.5, D4
- [ ] RAG-26 — Pass retrieved chunks as `document` blocks, `citations: {enabled: true}`  · TDD §2.5
- [ ] RAG-27 — Generation service: retrieve → prompt → cited answer  · TDD §2.5
- [ ] RAG-28 — **Abstain** when retrieval is empty/below floor (no free-generation)  · TDD §2.5, D5
- [ ] RAG-29 — `POST /query` → `{ answer, citations[], chunks[] }`  · TDD §2.6
- [ ] RAG-30 — Map citation spans back to source chunks  · TDD §2.5

## Milestone GO-21e — Minimal chat UI  (PRD FR-5)

- [ ] RAG-31 — Single-page chat UI calling `/query`  · TDD §2.7
- [ ] RAG-32 — Render answer + clickable citations  · TDD §2.7
- [ ] RAG-33 — Serve the static UI from Nest  · TDD §2.7

## Milestone GO-21f — Deploy to public URL  (PRD FR-7)

- [ ] RAG-34 — Pick host (Fly.io / Render / Railway) + decide  · TDD §4
- [ ] RAG-35 — Provision managed Postgres with pgvector  · TDD §4
- [ ] RAG-36 — Deploy app + apply schema/migrations on the host  · TDD §4
- [ ] RAG-37 — Public URL live + reachable `/healthz`  · GO-21f

## Milestone GO-21g — Retrieval eval harness  (PRD FR-6) — the quality gate

- [ ] RAG-38 — `eval/dataset.jsonl` labeled set (`question`, `relevant_doc_ids[]`)  · TDD §2.8
- [ ] RAG-39 — Eval runner: hit-rate + precision@k  · TDD §2.8
- [ ] RAG-40 — `npm run eval` prints per-question table + summary number  · TDD §2.8
- [ ] RAG-41 — Put the eval number in the README  · PRD §5, rule `evals.md`

## Cross-cutting / NFR  (TDD §3)

- [ ] RAG-42 — Structured logging baseline (pino or Nest logger)  · TDD §3
- [ ] RAG-43 — Secrets env-only; confirm none committed/logged  · rule `ai-and-secrets.md`
- [~] RAG-44 — Jest setup + unit tests (chunking, adapters)  · TDD §3 — Jest (ts-jest) configured + Voyage adapter spec done; chunking test pending RAG-15
- [ ] RAG-45 — Integration test: `/query` happy path  · TDD §3
- [ ] RAG-46 — Proper migration runner for deploy (vs. initdb-only)  · TDD §4
- [ ] RAG-47 — Pin deps / lockfile committed; clean commit history  · PRD §5
- [~] RAG-50 — Keep `doc/codemap.md` current after every code change (ongoing)  · rule `coding-standards.md`, `codemap` skill
- [~] RAG-51 — Append to `doc/LEARNINGS.md` after each build slice (ongoing)  · the revisit/teach log, distinct from ADRs

## Wrap-up

- [ ] RAG-48 — Production README: problem, architecture diagram, key decisions, eval numbers, configuration, roadmap (multi-agent = future work, D8)
- [ ] RAG-49 — Demo recording (GIF / short video) + clean commit history

---

*Decompose any RAG-<n> further as `RAG-<n>a` when needed. Retrieval-affecting changes (RAG-15/20-24/26) must be backed by an eval run — see rule `evals.md`.*
