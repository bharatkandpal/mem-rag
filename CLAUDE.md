# rag — project context

A pluggable retrieval-augmented chatbot with **citation-grounded answers** — point it at any document corpus and it answers questions over them, with sources. Read these first:

- `PRD.md` — what we're building and why (requirements, success criteria).
- `TDD.md` — how (architecture, schema, adapter interfaces, eval harness).
- `GO-21.md` — the milestone build order (GO-21a → h).
- `tasks.md` — the RAG-<n> execution checklist; the **live status ledger** — check it before starting work so you don't redo what's already done.

## Stack (locked — see TDD §1)

NestJS / TypeScript · Postgres + **pgvector** (HNSW) · **Voyage** embeddings behind a swappable adapter · **Claude `claude-opus-4-8`** generation with native citations · Docker Compose. **No LangChain/LlamaIndex** — a thin custom layer, on purpose.

## The two things that set the quality bar

1. **Swappable adapters** (`EmbeddingProvider`, `VectorStore`) — no vendor lock-in; keep the seams clean.
2. **The retrieval eval harness** (`npm run eval`) — the quantitative quality gate. Treat it as a first-class deliverable.

## Conventions

- All project rules live in `.claude/rules/` — read them; they're binding.
- Secrets via env only (`.env`, git-ignored). Never hardcode, never log, never put a key in a prompt.
- Any change that affects retrieval must be backed by an eval run (see `.claude/rules/evals.md`).

## Definition of done (any code change)

1. Code + matching test; typecheck and `npm test` pass.
2. `doc/codemap.md` updated when a symbol, route, env var, or signature under `src/` or `eval/` changed — the pre-commit hook enforces it.
3. Retrieval-affecting change → `npm run eval` with before/after stated (rule `evals.md`).
4. A learning appended to `doc/LEARNINGS.md` for the slice — it feeds interview prep; don't skip it.
5. Status ticked in `tasks.md` (and `GO-21.md` / README if a milestone moved).

## Tooling in this project

- Skills: `nest-module`, `ingest`, `add-adapter`, `db-migration`, `run-evals`, `answer-eval`, `smoke-test`, `codemap`, `git-ops`, `cli`. Commands: `/dev`, `/eval`. Agents: `retrieval-tuner` (Opus), `answer-judge` (Opus), `codemap-updater` (Sonnet).
- `doc/codemap.md` — files → symbols → usages. Check it before changing a function (to see what's affected); update it after writing code (rule `coding-standards.md`).
