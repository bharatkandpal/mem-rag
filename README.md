# RAG Knowledge-Store Chat

Retrieval-augmented chat with **citation-grounded answers**. NestJS · Postgres + pgvector · Voyage embeddings (swappable) · Claude `claude-opus-4-8` with native citations.

> This README is an early placeholder. The full product README — problem, architecture diagram, key decisions, eval numbers, configuration, and roadmap — comes with the wrap-up milestone. See `PRD.md`, `TDD.md`, `DESIGN_DECISIONS.md`, and `GO-21.md`.

## Run (one command)

```bash
cp .env.example .env          # health check needs no keys; ingest/generation do
docker compose up --build
```

Brings up the NestJS app and a pgvector-enabled Postgres. The DB schema (incl. the `vector` extension) is applied automatically on first start.

## Verify

```bash
curl -s localhost:3000/healthz
# {"status":"ok","db":true,"pgvector":true}
```

`/healthz` returns **200 `ok`** only when the DB is reachable *and* the `vector` extension is present; otherwise **503 `degraded`**.

## Retrieval quality

```bash
# Requires: docker compose up -d && POST /ingest on eval/sample-corpus
DATABASE_URL=postgresql://rag:rag@localhost:5432/rag npm run eval
```

Baseline over the 10-question sample corpus (`eval/dataset.jsonl`, `eval/sample-corpus/`), embeddings `voyage-4-lite`:

| Metric | Score |
|--------|-------|
| Hit-rate | **100%** (10/10) |
| Avg precision@5 | **0.42** |

(With 9 chunks total and k=5, ~0.4–0.6 is the structural precision ceiling — hit-rate is the headline metric at this corpus size.)

Run `npm run eval` after any retrieval change (chunk size, `k`, `MIN_SCORE`, embedding model) to confirm the number holds.

## Status

- ✅ **GO-21a** — scaffold: NestJS, pgvector via Docker Compose, env config, `/healthz`.
- ✅ **GO-21b** — ingestion pipeline: chunk → embed (Voyage) → pgvector upsert, `POST /ingest`.
- ✅ **GO-21c** — retrieval: cosine top-k (HNSW) with score floor, `RetrievalService`.
- ✅ **GO-21d** — generation: Claude `claude-opus-4-8` with native citations, `POST /query`.
- ✅ **GO-21g** — retrieval eval harness: `npm run eval`, hit-rate + precision@k — live baseline in the table above.
- ⬜ **GO-21h** — CLI wrapper (`rag ingest` / `rag query`) — next up.
- ⬜ GO-21e chat UI · GO-21f deploy (deferred).
