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

## Run fully key-free (self-hosted, no API keys)

The default stack needs a Voyage key (embeddings) and an Anthropic key (generation). To run the **whole pipeline locally with no keys**, overlay [`docker-compose.local.yml`](docker-compose.local.yml): it swaps in local, in-process `transformers.js` embeddings (RAG-56) and local generation via [Ollama](https://ollama.com/) through the OpenAI-compatible seam (RAG-60).

```bash
# 1. Host Ollama, bound so the container can reach it, with a small model pulled
OLLAMA_HOST=0.0.0.0:11434 ollama serve &
ollama pull qwen2.5:7b
# 2. Bring up the key-free stack (transformers embeddings + Ollama generation, no keys)
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
# 3. Ingest + query — no keys anywhere
curl -s localhost:3000/ingest -H 'content-type: application/json' -d '{"path":"eval/sample-corpus"}'
curl -s localhost:3000/query  -H 'content-type: application/json' -d '{"question":"What vector index does this project use?"}'
```

- **Ollama runs on the host, not in a container** — Docker Desktop on Apple Silicon has no GPU passthrough, so an in-container model would be CPU-only and slow. The app reaches it at `host.docker.internal:11434` (mapped for Linux via `extra_hosts`).
- **The one honest trade-off:** the OpenAI-compatible generation surface has **no native citations** (`citationsSupported: false`) — grounded retrieval and the abstain guarantee still hold, but span-level citations are Claude-only. For those, use the default `docker compose up`.
- **Switching an existing DB between the keyed (Voyage) and key-free (transformers) profiles needs a re-ingest** — the two embedders occupy different vector spaces (both 1024-dim, so no schema migration, but the vectors don't transfer). `MIN_SCORE` is model-specific too (`0.3` Voyage → `0.59` bge-large); the override sets it for you.
- First query downloads the embedding weights (~335MB) into a persistent `hfcache` volume. Retrieval quality is unchanged from the keyed run — the eval gate passes at **hit-rate 10/10**, abstain-rate **4/6** ([RAG-56](#retrieval-quality--the-eval-gate)).

This is a slice of the full [RAG-67](tasks.md) plug-and-play bundle; a single-command bundled-Ollama profile with first-boot seeding is the remaining work.

## Detailed setup guide

### 1. Prerequisites

- **Docker + Docker Compose** — runs the app and pgvector (Postgres 16) with no local Postgres needed.
- **Node.js 20+ and npm** — for the CLI, the eval harness, and tests. Only needed if you use those host-side tools; the API itself runs entirely in Docker.
- **API keys** — a [Voyage](https://www.voyageai.com/) key for embeddings and an [Anthropic](https://console.anthropic.com/) key for generation. Both are required for the *default* providers. Embeddings can instead run fully local and keyless with `EMBEDDING_PROVIDER=transformers` (in-process transformers.js), leaving only the Anthropic key.

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the two keys — everything else has a working default:

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

**Swappable embeddings, measured (RAG-56).** The local `transformers` provider (`Xenova/bge-large-en-v1.5`, in-process, no key) holds the bar — re-ingesting the same corpus and re-running the eval gives hit-rate **10/10**, precision@5 **0.50**, abstain-rate **4/6** at its own calibrated floor `MIN_SCORE=0.59`. The floor differs from Voyage's `0.3` because min-score is an *absolute* cosine cutoff and each model has its own similarity scale — so the floor is calibrated per embedding model, never shared. Same two tech-adjacent leaks as Voyage; a global floor can't separate them on either model.

## Configuration

Everything is env-driven — see [`.env.example`](.env.example). The interesting knobs: `EMBEDDING_PROVIDER`, `GENERATION_PROVIDER` (`anthropic` | `openai-compatible` — point the latter at Ollama/vLLM for fully-local generation), `RETRIEVAL_K`, `MIN_SCORE`, `CHUNK_TOKENS`/`OVERLAP_TOKENS`, `EVAL_MIN_HIT_RATE`/`EVAL_MIN_ABSTAIN_RATE`.

## What I'd add with more time

- **Multi-agent orchestration** — a router that decomposes multi-hop questions into sub-queries over the same retrieval substrate (deliberately out of scope this iteration; see `DESIGN_DECISIONS.md` D8).
- **Hybrid retrieval + reranker** — BM25 alongside cosine, cross-encoder rerank; the eval harness exists precisely to prove whether each is worth it.
- **Answer-level eval as CI** — LLM-as-judge for groundedness/citation accuracy (harness spec'd, gated on API budget).
- **Streaming responses, authn, and a hosted deploy** — the API is stateless and Dockerized; Fly.io/Render + managed Postgres is a one-day path.

## Docs

[`PRD.md`](PRD.md) — requirements · [`TDD.md`](TDD.md) — technical design · [`DESIGN_DECISIONS.md`](DESIGN_DECISIONS.md) — D1–D9 with tradeoffs · [`doc/LEARNINGS.md`](doc/LEARNINGS.md) — build log.
