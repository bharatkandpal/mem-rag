---
description: Bring up the RAG stack (app + pgvector) via Docker Compose and verify it's live.
---

Start the project for local development (PRD FR-7 — one-command run):

1. The default `docker compose up` is **key-free** — local embeddings (transformers.js) + a bundled Ollama generation server, no API keys needed. So `.env` is optional for the default profile. Keys are only for the opt-in **cloud** profile (`docker-compose.cloud.yml` — Voyage + Anthropic, native citations): for that, copy `.env.example` → `.env` and fill `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY`.
2. Run `docker compose up` (build if needed). Startup is health-gated (`service_completed_successfully`): `db` (Postgres + pgvector) → one-shot `migrate` → `ollama` + one-shot `ollama-pull` → one-shot `seed` (first-boot ingest of `eval/sample-corpus`) → `app` (NestJS). The schema is applied by the **migration runner** (`db/migrations/*.sql` via `dist/database/migrate.js`, RAG-46) — idempotent, tracks applied versions in `schema_migrations`, so it covers existing volumes and deploy (unlike the old initdb-only bootstrap). See the `db-migration` skill. For a host-only run (no compose), apply the schema with `npm run migrate` against `DATABASE_URL`.
3. Poll `GET /healthz` until it returns `{"status":"ok","db":true,"pgvector":true}`, then report the local URL and that the stack is live.
4. The default profile auto-seeds `eval/sample-corpus/` (the `seed` service) so `/query` works immediately. If the DB is empty (e.g. the cloud profile, or seed was skipped), run the `ingest` skill on `eval/sample-corpus/`.

For the cloud profile, run it **standalone** (single `-f`, not an overlay) so no bundled Ollama starts: `docker compose -f docker-compose.cloud.yml up --build` with the keys set in `.env`.
