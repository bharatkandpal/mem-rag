---
description: Run the retrieval eval harness and report hit-rate / precision@k.
---

Run the retrieval quality evals (the project's quality gate — PRD FR-6):

1. Ensure the stack is up (`/dev`) and the corpus is ingested.
2. Run `npm run eval` over `eval/dataset.jsonl`.
3. Report hit-rate and precision@k, list any failed questions with the likely cause, and — if this followed a change — state before → after.
4. Offer to update the README's eval number if it moved.

Follow the `run-evals` skill and the `evals.md` rule.
