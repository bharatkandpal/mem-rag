---
name: ingest
description: Run the document ingestion pipeline over a folder — chunk, embed, and upsert into pgvector. Use when the user wants to "ingest docs", load a corpus, re-index after changing chunking, or seed the demo data. Implements PRD FR-1 / TDD §2.3; ingestion is idempotent.
---

# ingest

Load a document folder into the vector store so it's queryable.

## Steps

1. Confirm the stack is up (`/dev`) and `DATABASE_URL` is set. The default embedder is key-free (`EMBEDDING_PROVIDER=transformers`); `VOYAGE_API_KEY` is only needed when `EMBEDDING_PROVIDER=voyage` (the cloud profile).
2. Run the ingester against the target folder (`POST /ingest` with `{ path }`, or the CLI entrypoint). It chunks (token-aware, overlap), embeds via the configured adapter, and upserts.
3. Report stats: docs, chunks, embedding dims, elapsed — from the structured logs.
4. **Idempotency:** re-ingesting the same docs must not duplicate rows (the `UNIQUE(doc_id, chunk_index)` upsert, TDD §2.2). If counts climb on a re-run, that's a bug — flag it.

## Guardrails

- Dimensionality must match the `chunks.embedding VECTOR(n)` column; a mismatched adapter needs a migration + full re-ingest (see `add-adapter`).
- If you changed chunking, this is a retrieval change → run `run-evals` afterward (rule `evals.md`).
