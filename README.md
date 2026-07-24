# RAG Knowledge-Store Chat

Point it at a folder of documents and ask questions in plain language — it answers **only from those documents, with citations to the exact source passages**, and says *"I don't have that information in the corpus"* rather than guess. Built as production AI infrastructure, not a demo: swappable providers, a quantitative retrieval eval gate, structured logging, one-command run.

**Stack:** NestJS/TypeScript · Postgres + pgvector (HNSW) · Voyage embeddings · Claude (`claude-opus-4-8`) with native citations · Docker Compose. No RAG framework — a thin, owned pipeline.

## Quick setup

Get from clone to a cited answer in four commands. Needs Docker, Node 20+, and a Voyage + Anthropic API key.

```bash
cp .env.example .env                          # add VOYAGE_API_KEY + ANTHROPIC_API_KEY
docker compose up --build -d                  # app + pgvector; schema applied on first start
npm install && npm run build                  # once, for the CLI
npx rag ingest ./docs                         # chunk → embed → store (idempotent)
npx rag query "How is retrieval scored?"      # cited answer in the terminal
# prefer a browser? the same stack already serves a chat UI at http://localhost:3000
```

Same pipeline over HTTP: `POST /ingest {path}` · `POST /query {question}`, or the browser chat UI at [`http://localhost:3000`](http://localhost:3000). Full walkthrough, config, and troubleshooting below.

## Detailed setup guide

### 1. Prerequisites

- **Docker + Docker Compose** — runs the app and pgvector (Postgres 16) with no local Postgres needed.
- **Node.js 20+ and npm** — for the CLI, the eval harness, and tests. Only needed if you use those host-side tools; the API itself runs entirely in Docker.
- **API keys** — a [Voyage](https://www.voyageai.com/) key for embeddings and an [Anthropic](https://console.anthropic.com/) key for generation. Both are required for the default providers.

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the two keys — everything else has a working default:

| Variable | Required | Default | What it controls |
|----------|----------|---------|------------------|
| `VOYAGE_API_KEY` | **yes** | — | Voyage embeddings (ingest + query) |
| `ANTHROPIC_API_KEY` | **yes** | — | Claude generation with native citations |
| `DATABASE_URL` | no | `postgresql://rag:rag@localhost:5432/rag` | Host-side tools (CLI, `npm run eval`) reach pgvector on localhost; the app inside Compose gets `db:5432` from the compose file |
| `EMBEDDING_PROVIDER` / `VOYAGE_MODEL` | no | `voyage` / `voyage-4-lite` | Embedding adapter + model |
| `GENERATION_PROVIDER` / `GENERATION_MODEL` | no | `anthropic` / `claude-opus-4-8` | Generation adapter + model (`openai-compatible` points at Ollama/vLLM for local generation — no native citations) |
| `RETRIEVAL_K` / `MIN_SCORE` | no | `5` / `0.3` | Top-k and the similarity floor below which the system abstains |
| `CHUNK_TOKENS` / `OVERLAP_TOKENS` | no | `512` / `64` | Chunking budget (retrieval-affecting — re-run the eval if changed) |
| `EVAL_MIN_HIT_RATE` / `EVAL_MIN_ABSTAIN_RATE` | no | `0.5` / `0.5` | Floors below which `npm run eval` exits non-zero |

Secrets are env-only and `.env` is git-ignored — never commit a key. See [`.env.example`](.env.example) for the annotated full list.

### 3. Start the stack

```bash
docker compose up --build -d
```

This brings up two services: `db` (`pgvector/pgvector:pg16`, exposed on `localhost:5432`) and the NestJS API (on `localhost:3000`). The schema and the `vector` extension are applied automatically on first start — no manual migration step. Verify it's live:

```bash
curl -s localhost:3000/healthz   # {"status":"ok","db":true,"pgvector":true}
```

`db: true` confirms the connection; `pgvector: true` confirms the extension loaded. Logs stream with `docker compose logs -f app`. The **browser chat UI is served on the same address** — open [`http://localhost:3000`](http://localhost:3000) (see [step 6](#6-chat-in-the-browser)).

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

**How it works.** The UI is a static `web/public/index.html` (vanilla JS, no framework) served by the NestJS app itself via `useStaticAssets` in [`src/main.ts`](src/main.ts). Because it's served by the app, it lives on the **same origin** as the API, so the browser just `fetch`es `POST /query` with no CORS and no second server to run. The page is a thin renderer over the existing `/query` contract (`{ answer, citations[], chunks[], abstained, citationsSupported }`):

- **Answer** — the model's markdown answer, formatted.
- **References sidebar** — one card per citation (source file + the quoted `citedText` span it's grounded on), followed by any other retrieved chunks under *"Also retrieved"* with their similarity scores.
- **Honest states** — a *grounded · N citations* badge; the abstain card; a *"provider can't cite"* note when a non-citing generation provider is configured (`citationsSupported: false`); and a network/error card.
- **Session extras** — a left history panel for the current session, a light/dark theme toggle, and collapsible sidebars.

The UI is baked into the Docker image (`Dockerfile`) and bind-mounted in Compose, so edits to `web/public/index.html` appear on an app restart with **no rebuild**. It adds nothing to the pipeline — it's purely a browser client of the same HTTP API the CLI and eval harness already share.

### 7. Verify retrieval quality (optional)

```bash
npm run eval     # runs the eval harness; exits non-zero below the hit-rate / abstain-rate floors
```

See [Retrieval quality](#retrieval-quality--the-eval-gate) for the baseline numbers.

### Troubleshooting

- **`healthz` shows `db: false`** — pgvector isn't up yet; give it a few seconds on first boot or check `docker compose logs db`.
- **`pgvector: false`** — the extension didn't load; a full `docker compose down -v && docker compose up --build` recreates the volume and re-runs init.
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

## Configuration

Everything is env-driven — see [`.env.example`](.env.example). The interesting knobs: `EMBEDDING_PROVIDER`, `GENERATION_PROVIDER` (`anthropic` | `openai-compatible` — point the latter at Ollama/vLLM for fully-local generation), `RETRIEVAL_K`, `MIN_SCORE`, `CHUNK_TOKENS`/`OVERLAP_TOKENS`, `EVAL_MIN_HIT_RATE`/`EVAL_MIN_ABSTAIN_RATE`.

## What I'd add with more time

- **Multi-agent orchestration** — a router that decomposes multi-hop questions into sub-queries over the same retrieval substrate (deliberately out of scope this iteration; see `DESIGN_DECISIONS.md` D8).
- **Hybrid retrieval + reranker** — BM25 alongside cosine, cross-encoder rerank; the eval harness exists precisely to prove whether each is worth it.
- **Answer-level eval as CI** — LLM-as-judge for groundedness/citation accuracy (harness spec'd, gated on API budget).
- **Streaming responses, authn, and a hosted deploy** — the API is stateless and Dockerized; Fly.io/Render + managed Postgres is a one-day path.

## Docs

[`PRD.md`](PRD.md) — requirements · [`TDD.md`](TDD.md) — technical design · [`DESIGN_DECISIONS.md`](DESIGN_DECISIONS.md) — D1–D9 with tradeoffs · [`doc/LEARNINGS.md`](doc/LEARNINGS.md) — build log.
