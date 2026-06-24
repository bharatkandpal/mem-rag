# Rule: evals back retrieval changes

Binding. Derived from PRD FR-6 and TDD §2.8 — the eval number is the project's quality gate.

- **Any change that can affect retrieval quality** — chunking strategy, chunk size/overlap, `k`, min-score floor, embedding model/adapter, index params (HNSW `m`/`ef`) — must be accompanied by an **eval run** (`npm run eval`), with the before/after numbers stated.
- Don't tune retrieval by vibes. If you can't show the metric moved (or held), the change isn't justified.
- Keep `eval/dataset.jsonl` honest and growing — when a real query fails, add it to the set.
- The current eval number belongs in the README. Keep it current.
