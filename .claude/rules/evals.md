# Rule: evals back retrieval changes

Binding. Derived from PRD FR-6 and TDD §2.8 — the eval number is the project's quality gate.

- **Any change that can affect retrieval quality** — chunking strategy, chunk size/overlap, `k`, min-score floor, embedding model/adapter, index params (HNSW `m`/`ef`) — must be accompanied by an **eval run** (`npm run eval`), with the before/after numbers stated.
- Don't tune retrieval by vibes. If you can't show the metric moved (or held), the change isn't justified.
- Keep `eval/dataset.jsonl` honest and growing — when a real query fails, add it to the set.
- The current eval number belongs in the README. Keep it current.
- `npm run eval` **exits non-zero** when hit-rate falls below `EVAL_MIN_HIT_RATE` (default 0.5) — usable as a CI gate.
- `eval/sample-corpus/` is **frozen fixture data** — the labels in `eval/dataset.jsonl` are tied to its exact contents. Never sync it with the real project docs; if you deliberately change it, re-validate every label and re-run the eval.
- A pre-commit hook blocks retrieval-affecting commits whose message carries no eval evidence — state before → after in the body (`[eval-ok]` only when the change genuinely can't affect retrieval quality).
