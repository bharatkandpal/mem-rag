---
name: db-migration
description: Author and apply Postgres/pgvector schema migrations safely. Use when changing the `chunks` schema, indexes, or — critically — the embedding dimensionality, or when moving from initdb-only to a real migration runner (RAG-46, TDD §4). Knows the pgvector dims trap and treats destructive changes with care.
---

# db-migration

Evolve the schema without breaking a running corpus.

## Current state

Schema is applied by a real migration runner (`src/database/migrate.ts`, `npm run migrate`, **RAG-46**) — the single schema authority. It reads the append-only files under `db/migrations/`, applies every one not yet in the `schema_migrations` ledger (each file + its ledger insert in one transaction), and is idempotent. In Compose a one-shot `migrate` service runs it before `seed`/`app`; for a host / managed Postgres run it directly (`DATABASE_URL=… npm run migrate`) or as a k8s Job / init-container. The old initdb-only bootstrap (`db/init/…`, first-start-only) is gone — it never re-ran on existing volumes and didn't cover production.

## Authoring a migration

- Add a numbered, append-only file: `db/migrations/00X_<change>.sql`.
- Make it **idempotent** (`IF NOT EXISTS` / `IF EXISTS`) so re-application is safe.
- Keep the schema in `TDD.md` §2.2 and the codemap's non-code-assets table in sync.

## The pgvector dimensionality trap (read before changing embeddings)

`chunks.embedding` is `VECTOR(1024)` — pinned to the default Voyage `voyage-3` dims. **Switching to a different-dimension embedding model is not a config change**, it's:
1. `ALTER TABLE chunks ALTER COLUMN embedding TYPE VECTOR(<new_dims>)` (only valid if the table is empty), **or** drop + recreate;
2. **drop and rebuild the HNSW index**;
3. **full re-ingest** of the corpus (old vectors are meaningless at new dims).

Flag this loudly whenever `add-adapter` introduces an embedding model with different `dims`. Never silently mismatch the column and the adapter — inserts will fail at runtime.

## Applying

- **Compose:** the one-shot `migrate` service applies pending migrations on every `up` (before `seed`/`app`); nothing to do by hand. A `docker compose down -v` + `up` rebuilds the volume and re-applies from scratch.
- **Local host / managed Postgres:** `npm run build && DATABASE_URL=… npm run migrate` — applies every pending `db/migrations/*.sql`. Idempotent (ledger-tracked), so re-running is a no-op.
- **Deploy (RAG-46):** run the runner as a step before the app starts (a k8s Job / init-container, a Fly `release_command`, …); the same idempotent runner covers it.

## Guardrails

- **Never** drop a table/column or rebuild an index that holds real data without confirming with the user — and prefer a backup first. Destructive DDL is irreversible.
- Migrations touching retrieval (index params, dims) → run `run-evals` after re-ingest and report before/after (rule `evals.md`).
