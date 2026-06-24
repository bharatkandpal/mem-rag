---
name: run-evals
description: Run the RAG retrieval eval harness and interpret the results. Use whenever the user wants to measure retrieval quality, "run the evals", check hit-rate / precision@k, or validate that a retrieval change (chunking, k, embeddings, index params) helped. This number is the project's quality gate (PRD FR-6, TDD §2.8) — keep it honest and current.
---

# run-evals

Measure retrieval quality and say what the number means — don't just print it.

## Steps

1. Ensure the stack is up (`/dev` or `docker compose up`) and the corpus is ingested.
2. Run `npm run eval` (the harness in `eval/`, see TDD §2.8). It scores each labeled question in `eval/dataset.jsonl` and reports **hit-rate** and **precision@k**.
3. Report: the headline numbers, which questions failed, and the likely cause (bad chunking? `k` too low? embedding mismatch? missing doc?).
4. If comparing a change, state **before → after** explicitly (the `evals.md` rule requires it).
5. Offer to update the README's eval number if it moved.

## Guardrails

- A retrieval change without a before/after number isn't done (see rule `evals.md`).
- When a real query fails in the app, add it to `eval/dataset.jsonl` so the set keeps reflecting reality.
- Don't tune by vibes — every knob (chunk size/overlap, `k`, min-score, HNSW params) is justified by the metric moving or holding.
