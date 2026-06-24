# rag — project context

A pluggable retrieval-augmented chatbot with **citation-grounded answers** — point it at any document corpus and it answers questions over them, with sources. Read these first:

- `PRD.md` — what we're building and why (requirements, success criteria).
- `TDD.md` — how (architecture, schema, adapter interfaces, eval harness).
- `GO-21.md` — the milestone build order (GO-21a → g).

## Stack (locked — see TDD §1)

NestJS / TypeScript · Postgres + **pgvector** (HNSW) · **Voyage** embeddings behind a swappable adapter · **Claude `claude-opus-4-8`** generation with native citations · Docker Compose. **No LangChain/LlamaIndex** — a thin custom layer, on purpose.

## The two things that set the quality bar

1. **Swappable adapters** (`EmbeddingProvider`, `VectorStore`) — no vendor lock-in; keep the seams clean.
2. **The retrieval eval harness** (`npm run eval`) — the quantitative quality gate. Treat it as a first-class deliverable.

## Conventions

- All project rules live in `.claude/rules/` — read them; they're binding.
- Secrets via env only (`.env`, git-ignored). Never hardcode, never log, never put a key in a prompt.
- Any change that affects retrieval must be backed by an eval run (see `.claude/rules/evals.md`).

## Tooling in this project

- Skills: `nest-module`, `ingest`, `add-adapter`, `db-migration`, `run-evals`, `answer-eval`, `smoke-test`, `codemap`, `git-ops`. Commands: `/dev`, `/eval`. Agents: `retrieval-tuner` (Opus), `answer-judge` (Opus), `codemap-updater` (Sonnet).
- `doc/codemap.md` — files → symbols → usages. Check it before changing a function (to see what's affected); update it after writing code (rule `coding-standards.md`).
