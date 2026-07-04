# rag — task tracker

> Granular execution checklist derived from `PRD.md` (FR-*), `TDD.md` (§*), and the `GO-21.md` milestones. IDs are `RAG-<n>` (stable, never reused). Check items off as they land; keep this current — it's the project's working source of truth.
>
> Legend: `[x]` done · `[~]` scaffolded, not runtime-verified · `[ ]` todo

---

## Milestone GO-21a — Scaffold / one-command run  (PRD FR-7)

- [x] RAG-1 — NestJS + TypeScript project (`package.json`, `tsconfig`, `nest-cli`)  · TDD §1
- [x] RAG-2 — Global config via `@nestjs/config` (env-driven)  · TDD §3
- [x] RAG-3 — Postgres `pg` Pool as injectable `PG_POOL`  · TDD §2.2
- [x] RAG-4 — `db/init/001_init.sql`: `vector` extension + `chunks` table + HNSW index  · TDD §2.2
- [x] RAG-5 — `GET /healthz` (DB reachable + pgvector present → 200/503)  · TDD §2.6
- [x] RAG-6 — Dockerfile + `docker-compose.yml` (app + pgvector), `.dockerignore`  · TDD §4
- [x] RAG-7 — `.env.example` with all keys  · TDD §3
- [x] RAG-8 — **Runtime-verify**: `docker compose up` → `/healthz` returns `ok` (db+pgvector true)  · GO-21a done-when

## Milestone GO-21b — Ingestion pipeline + embedding adapter  (PRD FR-1, FR-2)

- [x] RAG-9 — `EmbeddingProvider` interface (`dims`, `embed()`)  · TDD §2.1
- [x] RAG-10 — `VoyageEmbeddingProvider` (default `voyage-4-lite` via `VOYAGE_MODEL`; see D3 update)  · TDD §2.1, D3
- [x] RAG-11 — Provider factory selected by `EMBEDDING_PROVIDER` env  · TDD §2.1
- [x] RAG-12 — `VectorStore` interface (`upsert`, `search`)  · TDD §2.2 — both methods in place (`search` landed with RAG-21)
- [x] RAG-13 — `PgVectorStore.upsert()` (idempotent on `UNIQUE(doc_id, chunk_index)`)  · TDD §2.2
- [~] RAG-14 — Document loader (md / txt / pdf)  · TDD §2.3 — md/txt done + tested; PDF deferred to its own slice (D9)
- [x] RAG-15 — Token-aware chunker with overlap  · TDD §2.3 — recursive structure-aware, eval-tunable (D9)
- [x] RAG-16 — Ingestion service: load → chunk → embed → upsert  · TDD §2.3
- [x] RAG-17 — `POST /ingest` ({ path } → stats)  · TDD §2.6
- [x] RAG-18 — Structured logs on ingest (docs, chunks, ms)  · TDD §3
- [x] RAG-19 — Verify re-ingest is idempotent (row count stable)  · TDD §2.3 — live-verified: double ingest of the sample corpus, row count stable at 9

## Milestone GO-21c — Retrieval  (PRD FR-3)

- [x] RAG-20 — Embed query via the configured adapter  · TDD §2.4
- [x] RAG-21 — `PgVectorStore.search()`: cosine top-k over HNSW  · TDD §2.4
- [x] RAG-22 — Min-score floor (config `MIN_SCORE`)  · TDD §2.4, D5
- [x] RAG-23 — Retrieval service returns `{ content, source, score }[]`  · TDD §2.4
- [x] RAG-24 — `RETRIEVAL_K` configurable  · TDD §3

> ✅ **Eval-validated:** hit-rate 10/10 (100%), avg precision@5 0.43, abstain-rate 4/6 — `voyage-4-lite`, `MIN_SCORE=0.3` (calibrated, RAG-57; see README). Two documented abstain leaks (tech-adjacent + gibberish ≈0.35–0.37) are beyond what a global floor can separate.

## Milestone GO-21d — Generation with citations  (PRD FR-4)

- [x] RAG-25 — Anthropic SDK client, model `claude-opus-4-8`  · TDD §2.5, D4
- [x] RAG-26 — Pass retrieved chunks as `document` blocks, `citations: {enabled: true}`  · TDD §2.5
- [x] RAG-27 — Generation service: retrieve → prompt → cited answer  · TDD §2.5
- [x] RAG-28 — **Abstain** when retrieval is empty/below floor (no free-generation)  · TDD §2.5, D5
- [x] RAG-29 — `POST /query` → `{ answer, citations[], chunks[] }`  · TDD §2.6
- [x] RAG-30 — Map citation spans back to source chunks  · TDD §2.5
- [x] RAG-58 — `GenerationProvider` interface (`supportsCitations`, `generate()`); `GenerationService` reduced to a thin orchestrator (retrieve → abstain policy → delegate)  · TDD §2.5, D4 update
- [x] RAG-59 — `AnthropicGenerationProvider` — default impl, native citations, extracted from the old inline service logic  · TDD §2.5
- [x] RAG-60 — `OpenAICompatibleGenerationProvider` — proves the seam; any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, vLLM); `supportsCitations=false`, never fakes citations  · TDD §2.5, `add-adapter` skill
- [x] RAG-61 — `GENERATION_PROVIDER` env-selected factory in `GenerationModule` (default `anthropic`)  · TDD §2.5
- [x] RAG-62 — `QueryResult.citationsSupported` — honest per-provider capability flag surfaced through `POST /query`  · D4 update, rule `ai-and-secrets.md`

> ⚠️ Generation is implemented + unit-tested (mocked Anthropic client) but the live `/query` smoke is **blocked on Anthropic API credits** (billing — the account returned "credit balance too low"). Retrieval feeding it is eval-validated; re-run the smoke (cited answer + abstain) once credits are topped up.

## Milestone GO-21e — Minimal chat UI  (PRD FR-5) — **DEFERRED** (see GO-21.md)

- [ ] RAG-31 — Single-page chat UI calling `/query`  · TDD §2.7
- [ ] RAG-32 — Render answer + clickable citations  · TDD §2.7
- [ ] RAG-33 — Serve the static UI from Nest  · TDD §2.7

## Milestone GO-21f — Deploy to public URL  (PRD FR-7) — **DEFERRED** (see GO-21.md)

- [ ] RAG-34 — Pick host (Fly.io / Render / Railway) + decide  · TDD §4
- [ ] RAG-35 — Provision managed Postgres with pgvector  · TDD §4
- [ ] RAG-36 — Deploy app + apply schema/migrations on the host  · TDD §4
- [ ] RAG-37 — Public URL live + reachable `/healthz`  · GO-21f

## Milestone GO-21g — Retrieval eval harness  (PRD FR-6) — the quality gate

- [x] RAG-38 — `eval/dataset.jsonl` labeled set (`question`, `relevant_doc_ids[]`)  · TDD §2.8 — 10 questions over `eval/sample-corpus/`
- [x] RAG-39 — Eval runner: hit-rate + precision@k  · TDD §2.8 — live baseline: 10/10 hit-rate, 0.42 avg precision@5 (`voyage-4-lite`)
- [x] RAG-40 — `npm run eval` prints per-question table + summary number  · TDD §2.8 — verified live; exits 1 below `EVAL_MIN_HIT_RATE`
- [x] RAG-41 — Put the eval number in the README  · PRD §5, rule `evals.md` — README "Retrieval quality" table

## Milestone GO-21h — CLI wrapper (`rag ingest` / `rag query`)

- [x] RAG-52 — CLI entrypoint: `src/cli/main.ts` (commander) + `"bin": { "rag": "dist/cli/main.js" }`  · GO-21h, `cli` skill
- [x] RAG-53 — `rag ingest <path>` — `IngestionService` in-process (app context, no HTTP) → stats to stdout  · `cli` skill — **live-verified**: 4 docs → 9 chunks over `eval/sample-corpus`
- [x] RAG-54 — `rag query <question>` — `GenerationService` in-process → answer + citations to stdout; abstain passes through verbatim  · `cli` skill — abstain path live-verified (verbatim message, exit 0, no model call); provider errors → stderr, exit 1
- [~] RAG-55 — **Runtime-verify**: `npx rag query "…"` returns a cited answer in the terminal  · GO-21h done-when — wiring + abstain verified live; the **cited-answer** smoke shares the GO-21d blocker (Anthropic API credits) — re-run once topped up

## Cross-cutting / NFR  (TDD §3)

- [x] RAG-42 — Structured logging baseline (pino or Nest logger)  · TDD §3 — Nest Logger with counts **and** latency (ms) on ingest, retrieve, and generate paths
- [x] RAG-43 — Secrets env-only; confirm none committed/logged  · rule `ai-and-secrets.md` — audited: `.env` git-ignored + never tracked; no key patterns in tracked files; no keys in logger calls
- [x] RAG-44 — Jest setup + unit tests (chunking, adapters)  · TDD §3 — chunker, loader, Voyage adapter, pgvector store, retrieval, generation + eval-metrics specs all in place
- [x] RAG-45 — Integration test: `/query` happy path  · TDD §3 — full DI graph over HTTP (supertest); happy path + abstain (provider never called) + 400 validation; process-boundary adapters replaced at their tokens
- [ ] RAG-46 — Proper migration runner for deploy (vs. initdb-only)  · TDD §4
- [ ] RAG-47 — Pin deps / lockfile committed; clean commit history  · PRD §5
- [~] RAG-50 — Keep `doc/codemap.md` current after every code change (ongoing)  · rule `coding-standards.md`, `codemap` skill
- [~] RAG-51 — Append to `doc/LEARNINGS.md` after each build slice (ongoing)  · the revisit/teach log, distinct from ADRs
- [ ] RAG-56 — Second `EmbeddingProvider` impl (OpenAI or local), env-selected — proves the swap seam  · PRD FR-2 acceptance, TDD §2.1, GO-21 quality bar, `add-adapter` skill (mind the dims trap)
- [x] RAG-57 — Calibrate `MIN_SCORE` so out-of-corpus questions abstain  · D5 — floor 0.2 → 0.3, from measured score distributions (`eval/probe-scores.ts`); eval before → after: hit-rate 10/10 → 10/10, prec@5 0.42 → 0.43, abstain-rate 0/6 → **4/6**. Dataset seeded with 6 should-abstain entries + abstain-rate metric/gate (`EVAL_MIN_ABSTAIN_RATE`). Known residual: tech-adjacent junk + gibberish score ≈0.35–0.37, *above* the weakest legit question (0.33) — unfixable by a global floor; documented in README, left failing-honest in the eval set for answer-level grounding

## Wrap-up

- [ ] RAG-48 — Production README: problem, architecture diagram, key decisions, eval numbers, configuration, roadmap (multi-agent = future work, D8)
- [ ] RAG-49 — Demo recording (GIF / short video) + clean commit history

---

*Decompose any RAG-<n> further as `RAG-<n>a` when needed. Retrieval-affecting changes (RAG-15/20-24/26/56/57) must be backed by an eval run — see rule `evals.md`.*
*Generation-provider changes (RAG-58-62) touch the answer path, not retrieval — no eval run required, but an `answer-eval` pass is expected before shipping a new `GenerationProvider` (`add-adapter` skill).*
