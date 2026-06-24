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

## Status

- ✅ **GO-21a** — scaffold: NestJS, pgvector via Docker Compose, env config, `/healthz`.
- ⬜ GO-21b ingest · GO-21c retrieve · GO-21d cited generation · GO-21e UI · GO-21f deploy · GO-21g eval harness.
