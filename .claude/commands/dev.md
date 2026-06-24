---
description: Bring up the RAG stack (app + pgvector) via Docker Compose and verify it's live.
---

Start the project for local development (PRD FR-7 — one-command run):

1. Check `.env` exists; if not, copy `.env.example` and tell the user which keys to fill (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`).
2. Run `docker compose up` (build if needed). This starts `app` (NestJS) and `db` (Postgres + pgvector) and runs migrations.
3. Poll `GET /healthz` until it returns OK, then report the local URL and that the stack is live.
4. If the DB is empty, suggest running the `ingest` skill to seed the demo corpus.

If `docker-compose.yml` doesn't exist yet, we're pre-GO-21a — say so and offer to scaffold it.
