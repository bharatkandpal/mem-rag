---
name: db-migration
description: Author and apply Postgres/pgvector schema migrations safely. Use when changing the `chunks` schema, indexes, or — critically — the embedding dimensionality, or when moving from initdb-only to a real migration runner (RAG-46, TDD §4). Knows the pgvector dims trap and treats destructive changes with care.
---

# db-migration

Evolve the schema without breaking a running corpus.

## Current state

Schema is bootstrapped by `db/init/001_init.sql`, auto-applied by the Postgres container on **first** start only (initdb). That's fine for fresh local runs; it does **not** re-run on existing volumes, and it won't cover production. RAG-46 tracks a real migration runner for deploy.

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

- **Local:** apply against the running `db` (`psql "$DATABASE_URL" -f db/migrations/00X_*.sql`), or rebuild the volume for a clean initdb.
- **Deploy (RAG-46):** run migrations as a step before the app starts; idempotent files make this safe to re-run.

## Guardrails

- **Never** drop a table/column or rebuild an index that holds real data without confirming with the user — and prefer a backup first. Destructive DDL is irreversible.
- Migrations touching retrieval (index params, dims) → run `run-evals` after re-ingest and report before/after (rule `evals.md`).
