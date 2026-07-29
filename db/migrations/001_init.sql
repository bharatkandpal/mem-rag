-- Initial schema (TDD §2.2). Applied by the migration runner
-- (src/database/migrate.ts, `npm run migrate`, RAG-46) — the single schema
-- authority for both fresh local runs and deploy. Append-only + idempotent
-- (IF NOT EXISTS) so re-application is a no-op. VECTOR(1024) matches the
-- default Voyage voyage-3 embedding dimensionality (see the dims trap in the
-- db-migration skill before changing it).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunks (
  id          BIGSERIAL PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  source      TEXT NOT NULL,
  chunk_index INT  NOT NULL,
  content     TEXT NOT NULL,
  embedding   VECTOR(1024) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);
