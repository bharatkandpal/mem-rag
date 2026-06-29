# GO-21g — Retrieval Eval Harness Design

**Date:** 2026-06-29
**Status:** Approved

## Goal

A standalone `npm run eval` command that measures retrieval quality (hit-rate + precision@k) against a labeled dataset, producing a number that goes in the README and acts as the project's quantitative quality gate.

## Structure

```
eval/
  dataset.jsonl          # labeled questions — committed, corpus-independent
  run-eval.ts            # runner script
  sample-corpus/         # project docs for the initial demo corpus
    README.md
    TDD.md
    PRD.md
    GO-21.md
```

`package.json` adds: `"eval": "ts-node eval/run-eval.ts"`

### Swapping the corpus

To replace the sample corpus with real documents:
1. `docker compose down -v && docker compose up -d` — wipes pgvector state
2. Ingest the new folder via `POST /ingest`
3. Replace `eval/dataset.jsonl` with questions and `relevant_doc_ids` from the new corpus

The harness is corpus-agnostic — it runs queries against whatever is in the DB.

## Dataset format

`eval/dataset.jsonl` — one JSON object per line:

```jsonl
{"question": "What embedding model does the system use?", "relevant_doc_ids": ["TDD.md"]}
{"question": "What is the HNSW index used for?", "relevant_doc_ids": ["TDD.md"]}
{"question": "What does POST /ingest accept?", "relevant_doc_ids": ["TDD.md", "PRD.md"]}
```

`relevant_doc_ids` are relative paths matching the `source` column in the DB — the same value `DocumentLoader` sets (`docId === source`, relative to the ingest root).

Seed with ~10 questions covering the sample corpus. Add real queries as failures surface.

## Runner architecture

**Option chosen: NestJS app context (no HTTP server)**

`NestFactory.createApplicationContext(AppModule)` spins up the module graph, resolves `RetrievalService`, and calls `retrieve()` directly. Rationale: reuses the real embed→search→floor code path — no duplication, and eval numbers reflect actual production behaviour including the `MIN_SCORE` floor.

### Steps

1. **Bootstrap** — create app context, resolve `RetrievalService`
2. **Run** — for each dataset entry:
   - call `retrievalService.retrieve(question)` → `RetrievedChunk[]`
   - compute hit: `chunks.some(c => relevant_doc_ids.includes(c.source))`
   - compute precision: `chunks.filter(c => relevant_doc_ids.includes(c.source)).length / chunks.length` (0 if no chunks returned)
3. **Report** — print per-question table + summary; exit non-zero if hit-rate < `EVAL_MIN_HIT_RATE` (default 0.5)

### Output format

```
question                                     hit   prec@k
What embedding model does the system use?    ✓     0.40
What is the HNSW index used for?             ✓     0.20
What does POST /ingest accept?               ✗     0.00
─────────────────────────────────────────────────────────
hit-rate: 2/3 (66.7%)   avg precision@5: 0.20
```

## Metrics

| Metric | Definition | Why |
|--------|-----------|-----|
| Hit-rate | Fraction of questions where ≥1 relevant doc appears in top-k | Headline number — "does retrieval find the right doc?" |
| Precision@k | Avg fraction of top-k results that are relevant | Catches hits buried in noise |

`k` is whatever `RETRIEVAL_K` is set to in `.env` (default 5).

## Config

No new env vars required. Existing vars govern behaviour:
- `RETRIEVAL_K` — top-k passed to the store
- `MIN_SCORE` — cosine floor applied by `RetrievalService` (eval reflects this)
- `EVAL_MIN_HIT_RATE` — optional, exit-code gate (default 0.5)

## What this is not

- Not an answer-quality eval (that's `answer-eval` / GO-21 future work)
- Not an integration test of the HTTP layer
- Not a replacement for unit tests — it measures retrieval quality, not code correctness
