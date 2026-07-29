---
description: Bring up the RAG stack (app + pgvector) via Docker Compose and verify it's live.
---

Start the project for local development (PRD FR-7 — one-command run):

1. Check `.env` exists; if not, copy `.env.example` and tell the user which keys to fill (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`).
2. Run `docker compose up` (build if needed). This starts `db` (Postgres + pgvector), a one-shot `migrate` service, then `app` (NestJS). The schema is applied by the **migration runner** (`db/migrations/*.sql` via `dist/database/migrate.js`, RAG-46) — it runs on every `up`, is idempotent, and tracks applied versions in `schema_migrations`, so it covers existing volumes and deploy (unlike the old initdb-only bootstrap). See the `db-migration` skill. For a host-only run (no compose), apply the schema with `npm run migrate` against `DATABASE_URL`.
3. Poll `GET /healthz` until it returns OK, then report the local URL and that the stack is live.
4. If the DB is empty, suggest running the `ingest` skill on `eval/sample-corpus/` (the default demo corpus).

If `docker-compose.yml` doesn't exist yet, we're pre-GO-21a — say so and offer to scaffold it.
