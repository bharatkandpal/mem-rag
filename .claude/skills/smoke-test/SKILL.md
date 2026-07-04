---
name: smoke-test
description: Exercise the running API end-to-end against the live Docker stack — /healthz, /ingest, /query (including the abstain path). Use to verify a milestone actually works (GO-21a/RAG-8, after ingestion/RAG-19, before a commit or merge). A live smoke check, complementary to the Jest unit/integration tests.
---

# smoke-test

Prove the running system does the thing — not that the code compiles.

## Preconditions

Stack up (`/dev` → `docker compose up`) and, for ingest/query checks, the corpus ingested (`ingest` skill).

## Checks (run in order, stop reporting clearly on first failure)

1. **Health** — `curl -s localhost:3000/healthz` → expect `{"status":"ok","db":true,"pgvector":true}` (200). This alone is GO-21a / RAG-8.
2. **Ingest** — `POST /ingest {"path": "<sample dir>"}` → expect stats (docs, chunks > 0). Re-run once → row count **must not climb** (idempotency, RAG-19).
3. **Grounded answer** — `POST /query` with a question answerable from the corpus → expect a non-empty answer. Check `citationsSupported` in the response: if `true` (the `anthropic` default), also expect **citations** pointing at real source chunks; if `false` (a `GENERATION_PROVIDER=openai-compatible` setup), `citations` is expected to be `[]` — that's correct, not a failure, but the answer must still be grounded in the retrieved context (D4 update).
4. **Abstention** — `POST /query` with a question clearly *outside* the corpus → expect the **"not in the corpus" abstain**, not a fabricated answer (rule `ai-and-secrets.md`, D5). This check is as important as #3 — a RAG system that doesn't abstain is broken.

## Report

A pass/fail line per check, with the actual response on any failure. State which milestone this verifies.

## Guardrails

- This is a smoke check, not the test suite — it doesn't replace Jest unit/integration tests (RAG-44/45).
- Needs real API keys in `.env` for checks 2–4 (embeddings + generation); #1 needs none. Never echo the keys.
