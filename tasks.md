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

> ✅ **Live-verified 2026-07-17.** Generation is implemented + unit-tested (mocked Anthropic client) **and** now smoke-verified live end-to-end via the CLI (`rag query`): grounded answer with 7 native Claude citations mapped back to source chunks, plus the abstain path. Earlier credits/billing blocker is cleared.

## Milestone GO-21e — Minimal chat UI  (PRD FR-5)

> ✅ **Gate lifted 2026-07-28 — RAG-63 (observability framework) landed.** The user-facing surface now has request tracing / metrics / error surfacing behind it (correlation id is surfaced in the error body for the UI's `ErrorState`, GO-21e-h). UI is low-effort (the `/query` contract already returns `{answer, citations[], chunks[], citationsSupported}`).
>
> 🧭 **Sliced 2026-07-23** → [`subtasks/GO-21e.md`](subtasks/GO-21e.md) (RAG-31/32/33 re-cut into GO-21e-a…h). **Stack: React + Vite + TS; polish: full** (a deliberate revisit of the PRD "no UI polish" non-goal for the portfolio demo). Design guide: [`docs/ui-design-guide.md`](docs/ui-design-guide.md). Next actionable = **GO-21e-b (scaffold `web/`) — now unblocked.**

- [ ] RAG-31 — Single-page chat UI calling `/query`  · TDD §2.7 → sliced (see subtasks/GO-21e.md: GO-21e-d)
- [ ] RAG-32 — Render answer + clickable citations  · TDD §2.7 → sliced (see subtasks/GO-21e.md: GO-21e-f)
- [ ] RAG-33 — Serve the static UI from Nest  · TDD §2.7 → sliced (see subtasks/GO-21e.md: GO-21e-g)

## Milestone GO-21f — Deploy to public URL  (PRD FR-7) — **DEFERRED** (see GO-21.md)

- [ ] RAG-34 — Pick host (Fly.io / Render / Railway) + decide  · TDD §4
- [ ] RAG-35 — Provision managed Postgres with pgvector  · TDD §4
- [ ] RAG-36 — Deploy app + apply schema/migrations on the host  · TDD §4
- [ ] RAG-37 — Public URL live + reachable `/healthz`  · GO-21f
- [ ] RAG-64 — **IaC + Kubernetes deployment module** — container image + Helm chart / manifests in a **separate IaC module** (not app code); local cluster via minikube, so the service can be embedded inside other applications. **Depends on RAG-46** (a real migration runner — initdb-only won't survive a k8s/managed-Postgres deploy).  · TDD §4, deploy track

## Milestone GO-21g — Retrieval eval harness  (PRD FR-6) — the quality gate

- [x] RAG-38 — `eval/dataset.jsonl` labeled set (`question`, `relevant_doc_ids[]`)  · TDD §2.8 — 10 questions over `eval/sample-corpus/`
- [x] RAG-39 — Eval runner: hit-rate + precision@k  · TDD §2.8 — live baseline: 10/10 hit-rate, 0.42 avg precision@5 (`voyage-4-lite`)
- [x] RAG-40 — `npm run eval` prints per-question table + summary number  · TDD §2.8 — verified live; exits 1 below `EVAL_MIN_HIT_RATE`
- [x] RAG-41 — Put the eval number in the README  · PRD §5, rule `evals.md` — README "Retrieval quality" table

## Milestone GO-21h — CLI wrapper (`rag ingest` / `rag query`)

- [x] RAG-52 — CLI entrypoint: `src/cli/main.ts` (commander) + `"bin": { "rag": "dist/cli/main.js" }`  · GO-21h, `cli` skill
- [x] RAG-53 — `rag ingest <path>` — `IngestionService` in-process (app context, no HTTP) → stats to stdout  · `cli` skill — **live-verified**: 4 docs → 9 chunks over `eval/sample-corpus`
- [x] RAG-54 — `rag query <question>` — `GenerationService` in-process → answer + citations to stdout; abstain passes through verbatim  · `cli` skill — abstain path live-verified (verbatim message, exit 0, no model call); provider errors → stderr, exit 1
- [x] RAG-55 — **Runtime-verify**: `npx rag query "…"` returns a cited answer in the terminal  · GO-21h done-when — **live-verified 2026-07-17**: `npx rag query "How is retrieval scored?"` → grounded answer + 7 native citations mapped to source chunks (TDD.md/GO-21.md), exit 0; abstain path previously verified

## Milestone GO-21i — MCP server layer (expose RAG to AI agents)  — **PLAN-FIRST**

> Turns the pipeline into a retrieval **tool** any MCP-capable agent (Claude Desktop, Claude Code, custom agents) can call — a third entrypoint over the same in-process services, mirroring the CLI (GO-21h) and HTTP API. Design before code. Plan: [`docs/superpowers/plans/2026-07-17-mcp-layer.md`](docs/superpowers/plans/2026-07-17-mcp-layer.md).

- [ ] RAG-65 — **MCP layer — thorough design doc** (tool surface, service reuse, transport, auth, citation→MCP mapping, abstain semantics). Gates the build sub-tasks (RAG-65a…) decomposed from the plan once accepted.  · new capability, `add-adapter`-style seam

## Milestone GO-21j — Embeddable scaffold: `npm run rag init`  (Integrator persona, PRD §3) — **PLAN-FIRST**

> **Critical deliverable.** `npm run rag init` (a new `commander` subcommand + npm script) scaffolds the RAG capability **into a host project** — writes a wired `RagModule` + config (`.env.rag.example`, a pgvector compose snippet, the `chunks`/HNSW schema) into the target — so an integrator *embeds* RAG, not just runs it. **Shape decided 2026-07-23: scaffolding generator** (not library-only, not container — that's RAG-64/GO-21i). Reuses the in-process service seam (`createApplicationContext(AppModule)`); never forks pipeline logic. Requires making the package importable (`main`/`types`/`exports`, `RagModule` barrel).
>
> 🧭 **Sliced 2026-07-24** → [`subtasks/GO-21j.md`](subtasks/GO-21j.md) (RAG-66a…g; forks settled — Nest-first host, migration-based DB, importable+local-install, env-first `forRoot`). Approach note: [`docs/embeddable-scaffold-guide.md`](docs/embeddable-scaffold-guide.md). Next actionable = RAG-66b (make package importable, not gated); **RAG-66e depends on RAG-46** (migration runner — shared with RAG-64).

- [ ] RAG-66 — **`rag init` scaffolding generator — design + build**: target detection, the file set written, `RagModule.forRoot()` config surface, idempotent re-run, and the importable-package surface. **Slice before building** (`task-slice`).  · GO-21j, `cli` + `nest-module` skills → sliced (see subtasks/GO-21j.md)

## Milestone GO-21k — Plug-and-play self-hosted bundle: `docker compose up`  (Integrator persona) — **lowest-effort self-host**

> A batteries-included, **completely self-hosted default**: one `docker compose up` brings the whole stack online (app + pgvector + local model servers) with **no external API keys**, pre-seeded so a fresh boot answers a query out of the box. Ships RAG *as its own runnable appliance* — distinct from GO-21j (embed *into* a host) and GO-21f (deploy to a public URL). The low-effort counterpart to **RAG-64 (k8s/Helm IaC)** — that IaC track is a **separate, later discussion**.
>
> ⚠️ **Citation trade-off — flag, don't bury.** The key-free default runs generation through the OpenAI-compatible provider (RAG-60) against a local LLM → `supportsCitations=false` (rule `ai-and-secrets.md`). Grounded retrieval + abstain still hold, but native span-level citations are Claude-only. The bundle must surface this honestly and ship an opt-in **`cloud` compose profile** (Voyage + Anthropic) for the full-citation experience.

- [x] RAG-67 — **Plug-and-play self-hosted Docker bundle** — a `docker compose up` **default profile that is fully key-free**: local embeddings (RAG-56) + local generation via a bundled Ollama/OpenAI-compatible server (RAG-60), health-gated startup ordering, auto-applied `chunks`/HNSW schema, optional first-boot seed of `eval/sample-corpus` so `/query` works immediately; pinned image tags; an opt-in **`cloud` profile** (Voyage + Anthropic, native citations); README "Self-host in one command". **Depends on RAG-56** (key-free embeddings). **Slice before building** (`task-slice`).  · PRD FR-7, TDD §4, GO-21 quality bar  → **delivered** (sliced RAG-67a…g, see [`subtasks/RAG-67.md`](subtasks/RAG-67.md))
  - [x] **Key-free compose profile** — was `docker-compose.local.yml` overlay (host Ollama); **superseded** by the bundled default below, which folds it into the base `docker-compose.yml` and containerizes Ollama.
  - [x] **Container blocker fixed** — transformers.js weight cache is relocatable via `TRANSFORMERS_CACHE`; Dockerfile pre-creates a nonroot-owned `/hf-cache` (writable by the distroless nonroot user, persisted via the `hfcache` volume). Verified key-free end-to-end: ingest + grounded query + abstain, keys empty; eval gate green (hit-rate 10/10, abstain 4/6, precision@5 0.46).
  - [x] **Bundled in-compose Ollama + one-command default (RAG-67a…g)** — `docker-compose.yml` is now the fully key-free default: bundled `ollama` service + one-shot `ollama-pull` (`qwen2.5:3b`) + one-shot `seed` (CLI ingest of `eval/sample-corpus`) + `app`, health-gated (`service_completed_successfully`), pinned tags (`pgvector/pgvector:0.8.1-pg16`, `ollama/ollama:0.32.1`). Opt-in `docker-compose.cloud.yml` (Voyage + Anthropic, native citations). **Live-verified 2026-07-28 from a cold, keyless boot**: `/healthz` ok, first-boot seed `4 docs → 9 chunks`, grounded `/query` via local qwen2.5:3b (`citationsSupported:false`), abstain path, re-seed idempotent (row count stable at 9). README self-host section rewritten; no host Ollama.

## Cross-cutting / NFR  (TDD §3)

- [x] RAG-42 — Structured logging baseline (pino or Nest logger)  · TDD §3 — Nest Logger with counts **and** latency (ms) on ingest, retrieve, and generate paths
- [x] RAG-43 — Secrets env-only; confirm none committed/logged  · rule `ai-and-secrets.md` — audited: `.env` git-ignored + never tracked; no key patterns in tracked files; no keys in logger calls
- [x] RAG-44 — Jest setup + unit tests (chunking, adapters)  · TDD §3 — chunker, loader, Voyage adapter, pgvector store, retrieval, generation + eval-metrics specs all in place
- [x] RAG-45 — Integration test: `/query` happy path  · TDD §3 — full DI graph over HTTP (supertest); happy path + abstain (provider never called) + 400 validation; process-boundary adapters replaced at their tokens
- [ ] RAG-46 — Proper migration runner for deploy (vs. initdb-only)  · TDD §4
- [ ] RAG-47 — Pin deps / lockfile committed; clean commit history  · PRD §5
- [~] RAG-50 — Keep `doc/codemap.md` current after every code change (ongoing)  · rule `coding-standards.md`, `codemap` skill
- [~] RAG-51 — Append to `doc/LEARNINGS.md` after each build slice (ongoing)  · the revisit/teach log, distinct from ADRs
- [x] RAG-56 — Second `EmbeddingProvider` impl, env-selected — proves the swap seam. **Chosen: in-process transformers.js** (`TransformersEmbeddingProvider`, `@huggingface/transformers`, default `Xenova/bge-large-en-v1.5`) — the local / no-key / no-rate-limit story Voyage can't, with no separate server (deliberate deviation from the "Ollama / OpenAI-compatible" hint, which stays a future variant). Picked a **1024-dim** model → clean config swap, no migration (dims trap avoided). Eval before → after: **hit-rate 10/10 → 10/10, precision@5 0.43 → 0.50, abstain-rate 4/6 → 4/6**, with `MIN_SCORE` re-calibrated **0.3 → 0.59** (model-specific floor; probe data in RAG-56f). Re-ingested + eval-run against an isolated `rag_bge` DB so the Voyage corpus stayed intact.  · PRD FR-2 acceptance, TDD §2.1, GO-21 quality bar, `add-adapter` + `db-migration` skills  → sliced + delivered (see `subtasks/RAG-56.md`)
- [x] RAG-63 — **Observability framework** — metrics (`prom-client`) + `GET /metrics`, request tracing with correlation IDs across ingest/retrieve/generate, error surfacing. Builds on the structured-logging baseline (RAG-42).  · TDD §3, NFR → sliced 2026-07-23 (see subtasks/RAG-63.md: RAG-63a…h; **stack: thin** — `prom-client` /metrics + ALS correlation IDs + global exception filter). Approach note: docs/observability-guide.md. **Delivered 2026-07-28** (RAG-63b…h): new `src/observability/` module — ALS correlation middleware (honors/echoes `x-request-id`) + `CorrelatedLogger` via `app.useLogger` (zero call-site edits; CLI logs → stderr), `prom-client` registry + `GET /metrics` + HTTP interceptor (templated routes), domain series (`rag_ingest_*`, `rag_retrieval_score`, `rag_query_total{outcome}`, `rag_generation_duration_seconds{provider}`) via `@Optional` seams, and a global `AllExceptionsFilter` (`rag_errors_total{type}`; 5xx only — abstain/4xx never counted; enriches, never clobbers, intentional bodies). 114 tests green (+28); **live-smoke-verified** under `docker compose … local` (key-free): `/metrics` series move; one request's logs share its id across embed→store→service; forced 500 → `{statusCode,message,correlationId}` + echoed header + `rag_errors_total`; 400 kept its payload + gained `correlationId`, not counted. Not retrieval-affecting (`[eval-ok]`). **GO-21e gate lifted.**
- [x] RAG-57 — Calibrate `MIN_SCORE` so out-of-corpus questions abstain  · D5 — floor 0.2 → 0.3, from measured score distributions (`eval/probe-scores.ts`); eval before → after: hit-rate 10/10 → 10/10, prec@5 0.42 → 0.43, abstain-rate 0/6 → **4/6**. Dataset seeded with 6 should-abstain entries + abstain-rate metric/gate (`EVAL_MIN_ABSTAIN_RATE`). Known residual: tech-adjacent junk + gibberish score ≈0.35–0.37, *above* the weakest legit question (0.33) — unfixable by a global floor; documented in README, left failing-honest in the eval set for answer-level grounding

## Wrap-up

- [x] RAG-48 — Production README: problem, architecture diagram (mermaid), key decisions, eval numbers, configuration, roadmap (multi-agent = future work, D8) — quick start / CLI / eval commands runtime-verified as written; host-vs-container `DATABASE_URL` split fixed, compose `MIN_SCORE` fallback aligned to 0.3
- [ ] RAG-49 — Demo recording (GIF / short video) + clean commit history

---

*Decompose any RAG-<n> further as `RAG-<n>a` when needed. Retrieval-affecting changes (RAG-15/20-24/26/56/57) must be backed by an eval run — see rule `evals.md`.*
*Generation-provider changes (RAG-58-62) touch the answer path, not retrieval — no eval run required, but an `answer-eval` pass is expected before shipping a new `GenerationProvider` (`add-adapter` skill).*
