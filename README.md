# RAG Knowledge-Store Chat

Point it at a folder of documents and ask questions in plain language — it answers **only from those documents, with citations to the exact source passages**, and says *"I don't have that information in the corpus"* rather than guess. Built as production AI infrastructure, not a demo: swappable providers, a quantitative retrieval eval gate, structured logging, one-command run.

**Stack:** NestJS/TypeScript · Postgres + pgvector (HNSW) · Voyage embeddings · Claude (`claude-opus-4-8`) with native citations · Docker Compose. No RAG framework — a thin, owned pipeline.

## Quick start — one command, no API keys

The default `docker compose up` is **fully self-hosted and key-free**: pgvector + a bundled Ollama model server + the app (local in-process embeddings), with `eval/sample-corpus` **seeded on first boot** so `/query` answers out of the box.

```bash
docker compose up --build                     # pgvector + bundled Ollama + app, self-seeded
                                              # first boot pulls ~2GB (model + embed weights) — give it a few minutes
curl -s localhost:3000/query -H 'content-type: application/json' \
  -d '{"question":"What vector index does this project use?"}'   # grounded answer from the seeded corpus
# prefer a browser? the same stack serves a chat UI at http://localhost:3000
```

No keys, no host Ollama, nothing to configure. The one honest trade-off: local generation runs through the OpenAI-compatible seam, so answers are grounded but carry **no native citations** (`citationsSupported: false`) — the abstain guarantee still holds.

**Want native span-level citations?** Use the opt-in **cloud profile** (Voyage embeddings + Claude generation):

```bash
cp .env.example .env                          # set VOYAGE_API_KEY + ANTHROPIC_API_KEY
docker compose -f docker-compose.cloud.yml up --build   # self-seeded too; answers carry inline citations
```

Same pipeline over HTTP (`POST /ingest {path}` · `POST /query {question}`), the browser chat UI at [`http://localhost:3000`](http://localhost:3000), or the **CLI** (`npm install && npm run build`, then `npx rag ingest ./docs` / `npx rag query "…"`). Full walkthrough, config, and troubleshooting below.

## The two profiles

Both are a single command, both are health-gated, and both **seed `eval/sample-corpus` on first boot** (via the CLI ingest in-process) so a fresh boot answers immediately. Startup order: `db` + `ollama` become healthy → the model is pulled and the corpus is ingested (one-shot jobs) → the app starts.

| | **Default** — `docker compose up` | **Cloud** — `-f docker-compose.cloud.yml` |
|---|---|---|
| Embeddings | local `transformers.js` (`bge-large-en-v1.5`, keyless) | Voyage (`VOYAGE_API_KEY`) |
| Generation | bundled Ollama `qwen2.5:3b` (containerized, keyless) | Claude `claude-opus-4-8` (`ANTHROPIC_API_KEY`) |
| Citations | grounded, **no native citations** | **native span-level citations** |
| Keys needed | none | Voyage + Anthropic |

- **Grounding holds on both.** Retrieval and the abstain guarantee are identical across profiles; only the citation capability and the embedding/generation backends differ, and `citationsSupported` reports it honestly.
- **CPU trade-off (flagged, not buried).** The bundled Ollama is CPU-only on Docker Desktop / Apple Silicon (no GPU passthrough), so `qwen2.5:3b` is chosen to stay usable — generation is slower than a GPU. Faster on a Mac? Run host Ollama and point the app's `GENERATION_BASE_URL` at `http://host.docker.internal:11434/v1`, then comment out the bundled `ollama` + `ollama-pull` services (and app's `ollama-pull` dependency) in [`docker-compose.yml`](docker-compose.yml).
- **`MIN_SCORE` is per-embedder** — `0.60` for the key-free `bge-large`, `0.3` for Voyage — set per profile, since the absolute cosine floor doesn't transfer between models.
- **Switching profiles on an existing DB** reuses the same `pgdata` volume, but the two embedders occupy different (both 1024-dim) vector spaces — run `docker compose down -v` first for a clean swap.
- First boot downloads the embedding weights (~335MB, key-free profile) into a persistent `hfcache` volume and the model into `ollama-models`. Retrieval quality on the key-free profile matches the keyed run — the eval gate passes at **hit-rate 10/10**, abstain-rate **4/6** ([RAG-56](#retrieval-quality--the-eval-gate)).

## Detailed setup guide

### 1. Prerequisites

- **Docker + Docker Compose** — runs the app and pgvector (Postgres 16) with no local Postgres needed.
- **Node.js 20+ and npm** — for the CLI, the eval harness, and tests. Only needed if you use those host-side tools; the API itself runs entirely in Docker.
- **API keys** — **only for the cloud profile** (native citations): a [Voyage](https://www.voyageai.com/) key for embeddings and an [Anthropic](https://console.anthropic.com/) key for generation. The default `docker compose up` is key-free (local `transformers.js` embeddings + bundled Ollama) and needs neither — this section and the host-side CLI/eval tools below are what use the keys.

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the two keys **for the cloud profile** — everything else has a working default, and the key-free default profile needs no `.env` at all:

| Variable | Required | Default | What it controls |
|----------|----------|---------|------------------|
| `VOYAGE_API_KEY` | yes\* | — | Voyage embeddings (ingest + query). \*Not needed with `EMBEDDING_PROVIDER=transformers` (local, keyless) |
| `ANTHROPIC_API_KEY` | **yes** | — | Claude generation with native citations |
| `DATABASE_URL` | no | `postgresql://rag:rag@localhost:5432/rag` | Host-side tools (CLI, `npm run eval`) reach pgvector on localhost; the app inside Compose gets `db:5432` from the compose file |
| `EMBEDDING_PROVIDER` / `VOYAGE_MODEL` | no | `voyage` / `voyage-4-lite` | Embedding adapter + model. `EMBEDDING_PROVIDER=transformers` runs local, in-process, keyless embeddings (`EMBEDDING_MODEL`, default `Xenova/bge-large-en-v1.5`, 1024-dim) |
| `GENERATION_PROVIDER` / `GENERATION_MODEL` | no | `anthropic` / `claude-opus-4-8` | Generation adapter + model (`openai-compatible` points at Ollama/vLLM for local generation — no native citations) |
| `RETRIEVAL_K` / `MIN_SCORE` | no | `5` / `0.3` | Top-k and the similarity floor below which the system abstains. `MIN_SCORE` is model-specific — `0.3` for Voyage, `0.59` for bge-large (transformers) |
| `CHUNK_TOKENS` / `OVERLAP_TOKENS` | no | `512` / `64` | Chunking budget (retrieval-affecting — re-run the eval if changed) |
| `EVAL_MIN_HIT_RATE` / `EVAL_MIN_ABSTAIN_RATE` | no | `0.5` / `0.5` | Floors below which `npm run eval` exits non-zero |
| `METRICS_ENABLED` | no | `true` | Gates the Prometheus `GET /metrics` route + process collectors (see [Observability](#observability--metrics-tracing-error-surfacing)) |

Secrets are env-only and `.env` is git-ignored — never commit a key. See [`.env.example`](.env.example) for the annotated full list.

### 3. Start the stack

The **default** stack is key-free and self-seeding (see Quick start above):

```bash
docker compose up --build -d                  # key-free: db + bundled ollama + app, self-seeded
```

For the **cloud profile** (Voyage + Anthropic, native citations), with keys in `.env`:

```bash
docker compose -f docker-compose.cloud.yml up --build -d
```

Either way the schema and the `vector` extension are applied automatically by a one-shot **`migrate`** service that runs before the app — no manual step. The default profile brings up `db` (`pgvector/pgvector:0.8.1-pg16`, exposed on `localhost:5432`), a bundled `ollama` server, one-shot `migrate` + `ollama-pull` + `seed` jobs, and the NestJS API (on `localhost:3000`). Verify it's live:

```bash
curl -s localhost:3000/healthz   # {"status":"ok","db":true,"pgvector":true}
curl -s localhost:3000/metrics   # Prometheus metrics (see Observability below)
```

`db: true` confirms the connection; `pgvector: true` confirms the extension loaded. Logs stream with `docker compose logs -f app` — each line carries the request's correlation id (see [Observability](#observability--metrics-tracing-error-surfacing)). The **browser chat UI is served on the same address** — open [`http://localhost:3000`](http://localhost:3000) (see [step 6](#6-chat-in-the-browser)).

**Schema & migrations.** The schema lives in versioned, append-only files under [`db/migrations/`](db/migrations) and is applied by a small migration runner (`src/database/migrate.ts`), not a first-boot-only initdb hook — so it also covers existing volumes and managed Postgres. In Compose the one-shot `migrate` service runs it automatically; against your own database run it directly:

```bash
npm run build && DATABASE_URL=postgres://… npm run migrate   # applies every pending db/migrations/*.sql
```

It's idempotent — each migration is recorded in a `schema_migrations` ledger and re-runs are a no-op — so it's safe as a pre-deploy step (a k8s Job / init-container, a Fly `release_command`, etc.). To add a schema change, drop a new numbered `db/migrations/00N_<change>.sql` (see the `db-migration` skill for the pgvector dimensionality trap).

### 4. Build the CLI (host-side tools)

The CLI, eval harness, and tests run on your host and reuse the same services in-process:

```bash
npm install && npm run build     # compiles to dist/, wires up the `rag` bin
```

### 5. Ingest a corpus and query it

```bash
npx rag ingest ./docs                        # chunk → embed → upsert into pgvector (idempotent — safe to re-run)
npx rag query "How is retrieval scored?"     # prints a citation-grounded answer, or abstains
```

Or drive the same pipeline over HTTP:

```bash
curl -s localhost:3000/ingest -H 'content-type: application/json' -d '{"path":"./docs"}'
curl -s localhost:3000/query  -H 'content-type: application/json' -d '{"question":"How is retrieval scored?"}'
```

Ingestion is idempotent — re-running over unchanged files won't duplicate chunks.

### 6. Chat in the browser

The stack **already serves a single-page chat UI** — no separate frontend server, no build step. Once the stack is up (step 3) and a corpus is ingested (step 5), open:

```
http://localhost:3000
```

Ask a question and you get the same grounded, cited answer the API returns — rendered with a **References panel** listing each cited source and its exact quoted passage — or an honest *"not in the corpus"* when nothing clears the score floor.

**How it works.** The UI is a static `web/public/index.html` (vanilla JS, no framework) served by the NestJS app itself via `useStaticAssets` in [`src/main.ts`](src/main.ts). Because it's served by the app, it lives on the **same origin** as the API, so the browser just `fetch`es `POST /query` with no CORS and no second server to run. The page is a thin renderer over the existing `/query` contract (`{ answer, citations[], chunks[], abstained, citationsSupported, grounded }`):

- **Answer** — the model's markdown answer, formatted.
- **References sidebar** — one card per citation (source file + the quoted `citedText` span it's grounded on), followed by any other retrieved chunks under *"Also retrieved"* with their similarity scores.
- **Honest states** — a *grounded · N citations* badge; the abstain card; a *"provider can't cite"* note when a non-citing generation provider is configured (`citationsSupported: false`); and a network/error card.
- **Opt-in general knowledge** — on an abstain, an *"Answer from general knowledge →"* button calls the separate `POST /query/general` route and renders the result as an **amber, clearly-labelled non-corpus card** (`grounded: false`, no citations). The default `/query` abstain guarantee is untouched — this is an explicit, user-initiated escape hatch, never automatic (see [`ai-and-secrets.md`](.claude/rules/ai-and-secrets.md)).
- **Session extras** — a left history panel for the current session (each entry deletable), a light/dark theme toggle, and collapsible sidebars.

The UI is baked into the Docker image (`Dockerfile`) and bind-mounted in Compose, so edits to `web/public/index.html` appear on an app restart with **no rebuild**. It adds nothing to the pipeline — it's purely a browser client of the same HTTP API the CLI and eval harness already share.

### 7. Verify retrieval quality (optional)

```bash
npm run eval     # runs the eval harness; exits non-zero below the hit-rate / abstain-rate floors
```

See [Retrieval quality](#retrieval-quality--the-eval-gate) for the baseline numbers.

### Troubleshooting

- **`healthz` shows `db: false`** — pgvector isn't up yet; give it a few seconds on first boot or check `docker compose logs db`.
- **`pgvector: false`** — the extension didn't load; a full `docker compose down -v && docker compose up --build` recreates the volume and re-runs the `migrate` service.
- **CLI / eval can't connect to Postgres** — host-side tools use `DATABASE_URL` on `localhost:5432`; make sure the `db` service is running and the port isn't shadowed by another Postgres.
- **Query always abstains** — either nothing has been ingested yet, or the question is genuinely out-of-corpus; lower `MIN_SCORE` only with an eval run to back it (see the evals rule).
- **`401` from a provider** — a missing or invalid `VOYAGE_API_KEY` / `ANTHROPIC_API_KEY` in `.env`.

## Architecture

```mermaid
flowchart LR
  subgraph Ingestion
    A[docs: md / txt] --> B[structure-aware chunker<br/>token budget + overlap]
    B --> C[EmbeddingProvider<br/><i>Voyage · swappable</i>]
    C --> D[(pgvector<br/>HNSW, cosine)]
  end
  subgraph Query
    Q[question] --> E[embed query]
    E --> D
    D -->|top-k ≥ score floor| F{any chunks?}
    F -->|no| G[abstain — no free generation]
    F -->|yes| H[GenerationProvider<br/><i>Claude native citations · swappable</i>]
    H --> I[answer + citations<br/>mapped to source chunks]
  end
```

Two entrypoints (HTTP API, CLI) and the eval harness all drive the **same services in-process** — no duplicated pipeline logic. The browser chat UI (served by the app at `/`) sits on top of the HTTP API as a thin client, not a fourth pipeline.

## Key design decisions

- **pgvector over Pinecone/Qdrant** — at 1–10M vectors a dedicated vector DB buys nothing but an extra service to operate; Postgres gives transactional upserts, SQL tooling, and one `docker compose` service. The `VectorStore` interface keeps the exit door open.
- **Native Claude citations, never prompt-engineered ones** — citations come from the model's citation API with spans mapped back to source chunks. Providers without native support (an OpenAI-compatible/local adapter is included) report `citationsSupported: false` and return none: **a fabricated citation is worse than an absent one.**
- **Abstain is enforced policy, not a prompt suggestion** — if nothing clears the similarity floor, the model is never called. The floor (0.3) was calibrated from measured in-corpus vs. out-of-corpus score distributions, not vibes (`eval/probe-scores.ts`).
- **Swappable adapters at every model boundary** — `EmbeddingProvider`, `VectorStore`, `GenerationProvider`; each has two implementations or a documented seam. The same DI tokens double as integration-test seams.
- **No LangChain/LlamaIndex** — the whole pipeline is ~10 small files you can read; every retrieval knob is tunable against the eval harness.
- **Observable by construction, thin by choice** — Prometheus metrics, `AsyncLocalStorage` correlation IDs threaded into every log line (zero call-site edits), and a global exception filter that counts only real 5xx faults (abstain and 4xx never count). In-process `prom-client` + ALS, no OTLP collector — with the seams left open for an OpenTelemetry upgrade. See [Observability](#observability--metrics-tracing-error-surfacing).

## Retrieval quality — the eval gate

```bash
npm run eval        # exits non-zero below hit-rate / abstain-rate floors (CI-usable)
```

Baseline (`eval/dataset.jsonl`: 10 answerable + 6 should-abstain questions, `voyage-4-lite`, `MIN_SCORE=0.3`):

| Metric | Score |
|--------|-------|
| Hit-rate | **100%** (10/10) |
| Avg precision@5 | **0.43** |
| Abstain-rate (out-of-corpus) | **67%** (4/6) |

(9 chunks, k=5 → ~0.4–0.6 is the structural precision ceiling; hit-rate is the headline at this corpus size.)

Calibrating the floor 0.2 → 0.3 moved abstain-rate 0/6 → 4/6 with hit-rate unchanged. The two remaining leaks (tech-adjacent junk scoring ≈0.35, *above* the weakest real question at 0.33) are unfixable by a global similarity floor — they stay in the eval set as documented failures for answer-level grounding to catch. Any retrieval-affecting change must ship with before/after eval numbers; a pre-commit hook enforces it.

**Swappable embeddings, measured (RAG-56).** The local `transformers` provider (`Xenova/bge-large-en-v1.5`, in-process, no key) holds the bar — re-ingesting the same corpus and re-running the eval gives hit-rate **10/10**, precision@5 **0.50**, abstain-rate **4/6** at its own calibrated floor `MIN_SCORE=0.59`. The floor differs from Voyage's `0.3` because min-score is an *absolute* cosine cutoff and each model has its own similarity scale — so the floor is calibrated per embedding model, never shared. Same two tech-adjacent leaks as Voyage; a global floor can't separate them on either model.

## Observability — metrics, tracing, error surfacing

Production infrastructure has to be **observable**, not just correct. Every request is traceable end-to-end, every path is measured, and every failure is surfaced with the same id — built as a thin, owned layer (`prom-client` + Node's `AsyncLocalStorage` + a global exception filter), no OpenTelemetry collector or extra service to run. It all lives in one module, [`src/observability/`](src/observability), and is wired globally so no feature code had to change.

### `GET /metrics` — Prometheus scrape endpoint

```bash
curl -s localhost:3000/metrics        # Prometheus text; scrape it with Prometheus/Grafana
```

Mirrors `/healthz`; gated by `METRICS_ENABLED` (default `true` — set `false` to disable the route and the process collectors). Alongside `prom-client`'s default process/GC/event-loop metrics, it exposes the domain series:

| Metric | Type | Labels | What it tells you |
|--------|------|--------|-------------------|
| `rag_http_requests_total` | counter | `route`, `method`, `status` | request volume by endpoint + status |
| `rag_http_request_duration_seconds` | histogram | `route` | end-to-end latency per endpoint |
| `rag_ingest_docs_total` · `rag_ingest_chunks_total` | counter | — | ingestion throughput |
| `rag_retrieval_score` | histogram | — | top-hit cosine similarity (the distribution behind `MIN_SCORE` tuning) |
| `rag_query_total` | counter | `outcome` = `grounded` \| `abstained` \| `general` | query outcomes — **abstain is a distinct outcome, never an error** |
| `rag_generation_duration_seconds` | histogram | `provider` | model latency by generation provider |
| `rag_errors_total` | counter | `type` | surfaced server faults (5xx) by exception class |

Labels are deliberately **low-cardinality** — `route` is the templated path (`/query`, never the request body), `outcome`/`provider`/`type` are fixed enums. HTTP metrics are recorded by a Nest **interceptor** (not middleware) so only matched controller routes are counted and the static UI assets never inflate the series.

### Request tracing — correlation IDs

Every request runs inside an `AsyncLocalStorage` scope carrying one correlation id: an inbound `x-request-id` is honored (so an upstream/proxy trace id is preserved), otherwise a UUID is minted, and it's **echoed on the response `x-request-id` header**.

```bash
curl -si localhost:3000/query -H 'x-request-id: trace-abc' \
  -H 'content-type: application/json' -d '{"question":"How is retrieval scored?"}' | grep -i x-request-id
# → x-request-id: trace-abc   (and every log line for this request is prefixed [trace-abc])
```

A custom logger reads the id from the ALS scope and prefixes **every existing structured log line** — across ingest → retrieve → generate — with **zero call-site changes** (it's registered via `app.useLogger`, and Nest's per-class loggers delegate to it). The **CLI** wraps each `rag ingest` / `rag query` invocation in its own scope too, and routes those logs to **stderr** so stdout stays a clean, pipeable result.

### Error surfacing

A global exception filter makes every failure traceable and honest:

```jsonc
// an unexpected fault → generic body, no internal detail leaked, id in body + header
{ "statusCode": 500, "message": "Internal server error", "correlationId": "trace-abc" }
```

- **Only genuine server faults (5xx) count as errors** — they bump `rag_errors_total{type}` and are logged with a stack trace. **Abstain (a 200) and 4xx validation are expected control flow and are never counted** — the abstain guarantee (D5) holds in the metrics too, so the error rate never lies.
- **Intentional payloads are enriched, not replaced** — a `/healthz` 503 keeps its `{db, pgvector}` flags and a validation 400 keeps its field message; the filter only *adds* `correlationId`. An unexpected (non-HTTP) error returns the generic body above — the real message and stack go to the log only, **never to the client** (no secret leak).

### Design stance

Thin and in-process on purpose — same "no framework" ethos as the rest of the pipeline. The correlation-ID generation and the metrics registry sit behind small internal seams, so a later upgrade to OpenTelemetry traces / OTLP export is **additive, not a rewrite** — deliberately deferred, not built now. Observability is **not retrieval-affecting**, so it ships without an eval run (`[eval-ok]`).

## Configuration

Everything is env-driven — see [`.env.example`](.env.example). The interesting knobs: `EMBEDDING_PROVIDER`, `GENERATION_PROVIDER` (`anthropic` | `openai-compatible` — point the latter at Ollama/vLLM for fully-local generation), `RETRIEVAL_K`, `MIN_SCORE`, `CHUNK_TOKENS`/`OVERLAP_TOKENS`, `EVAL_MIN_HIT_RATE`/`EVAL_MIN_ABSTAIN_RATE`, `METRICS_ENABLED` (default `true`; gates `/metrics` + the process collectors).

## What I'd add with more time

- **Multi-agent orchestration** — a router that decomposes multi-hop questions into sub-queries over the same retrieval substrate (deliberately out of scope this iteration; see `DESIGN_DECISIONS.md` D8).
- **Hybrid retrieval + reranker** — BM25 alongside cosine, cross-encoder rerank; the eval harness exists precisely to prove whether each is worth it.
- **Answer-level eval as CI** — LLM-as-judge for groundedness/citation accuracy (harness spec'd, gated on API budget).
- **Streaming responses, authn, and a hosted deploy** — the API is stateless and Dockerized; Fly.io/Render + managed Postgres is a one-day path.

## Docs

[`PRD.md`](PRD.md) — requirements · [`TDD.md`](TDD.md) — technical design · [`DESIGN_DECISIONS.md`](DESIGN_DECISIONS.md) — D1–D9 with tradeoffs · [`doc/LEARNINGS.md`](doc/LEARNINGS.md) — build log.
