---
name: answer-eval
description: Evaluate answer quality with an LLM-as-judge — groundedness (is the answer supported by the retrieved chunks?), citation accuracy (do citations point to the right sources?), and abstention correctness (does it decline when it should?). The generation-side complement to run-evals (which measures retrieval). Use to validate FR-4 / D5, before deploy, or after changing the generation path. Triggers on "evaluate answer quality", "is it grounded", "are the citations right".
---

# answer-eval

Retrieval evals (`run-evals`) prove the right chunks come back. This proves the *answer* is faithful to them. Both numbers belong in the README.

## What it measures

For each question, the judge scores:
- **Groundedness** — every claim in the answer is supported by a retrieved chunk (penalise anything not in the context — that's hallucination).
- **Citation accuracy** — cited sources actually contain the cited claim.
- **Abstention correctness** — out-of-corpus questions get the abstain, not a fabricated answer (D5).

## Method

1. Maintain the canonical answer-eval set **`eval/answers.jsonl`** (a sibling of `dataset.jsonl`), each item `{ question, expected: "answerable" | "abstain", relevant_doc_ids? }`.
2. For each question: call `POST /query`, capture `answer` + `citations` + `chunks`.
3. **Judge with `claude-opus-4-8`** (LLM-as-judge): give it the question, the answer, the citations, and the retrieved chunks; have it score the three axes with a one-line justification each. Consult the `claude-api` capability for current SDK shapes — don't guess.
4. Aggregate: % grounded, % citations correct, % abstained-correctly. Surface failures with the judge's reason.

## Dispatching

For a full set, dispatch the **`answer-judge`** agent (Opus) — it runs the batch and returns scores + failure analysis, keeping the main thread clear.

## Guardrails

- The judge must be **strict** — reward abstention over a confident wrong answer; an ungrounded claim fails even if it sounds right.
- Include should-abstain cases in the set, or you're only testing the easy half.
- A generation-path change without an answer-eval pass isn't validated.
