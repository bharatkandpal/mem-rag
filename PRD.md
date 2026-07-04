# PRD — RAG Knowledge-Store Chat

> Product Requirements. The "what" and "why". Technical "how" lives in `TDD.md`; the build sequence in `GO-21.md`.

## 1. Purpose

A pluggable retrieval-augmented chatbot that returns **citation-grounded answers** over any document corpus. Point it at a project's documents and it becomes a Q&A assistant for them — accurate, sourced, and honest about what it doesn't know. Built to production standards (swappable adapters, a retrieval eval harness, structured logging, env-based config) so it can be dropped into a real product, not just demoed.

## 2. Goals & non-goals

**Goals**
- Ask a natural-language question → get an accurate answer with **inline citations** to the exact source chunks.
- Ingest an arbitrary folder of documents and make them queryable.
- Be runnable by a stranger in **one command**, and demoable at a **public URL**.
- Demonstrate engineering maturity: swappable adapters, a **quantitative retrieval-eval harness**, structured logging, env-based config.

**Non-goals (this iteration)**
- Multi-agent orchestration (out of scope — a separate concern; see DESIGN_DECISIONS D8).
- Auth/multi-tenancy, fine-tuning, streaming UI polish, mobile.
- Scaling beyond ~1–10M vectors (single-node pgvector is deliberately sufficient).

## 3. Users

- **Integrator:** a developer plugging the chatbot into a project — points it at a document corpus, ingests, and exposes `/query`.
- **End user:** anyone asking questions over that corpus who needs trustworthy, cited answers (and a clear "not in the corpus" when there's no support).

## 4. Functional requirements

| # | Requirement | Acceptance |
|---|-------------|------------|
| FR-1 | Ingest a folder of documents (md/txt/pdf) | Pointing the ingester at a folder lands chunked, embedded rows; re-runs are idempotent |
| FR-2 | Chunk + embed documents via a **swappable embedding adapter** | Default Voyage adapter works; a second adapter can be dropped in without touching call sites |
| FR-3 | Retrieve top-k relevant chunks for a query | Query returns ranked chunks with source + similarity score |
| FR-4 | Generate a grounded answer with **citations**, via a swappable generation provider | Default (Claude) provider cites the specific source chunks it used; every provider is constrained to retrieved context only — no answer without it, and no provider fabricates citations it can't verify |
| FR-5 | Minimal chat UI | A non-technical user asks questions in a browser and sees cited answers |
| FR-6 | **Retrieval eval harness** | `npm run eval` prints retrieval-quality metrics (hit-rate / precision@k) over a labeled set |
| FR-7 | One-command run | `git clone` → `docker compose up` → app + DB live locally |

## 5. Success criteria

- A new user reaches a working, cited answer in **<60 seconds** from `docker compose up` — no code changes.
- The eval harness reports a **real retrieval-quality number** in the README, so quality is measurable and regressions are caught.
- A clear README a developer can integrate from: problem → architecture diagram → key decisions → configuration → roadmap.

## 6. Quality / non-functional requirements

- **Grounding:** never fabricate — answers must derive from retrieved chunks; abstain when retrieval is empty.
- **Observability:** structured logs on ingest + query paths.
- **Config:** all secrets/endpoints via environment; nothing hardcoded.
- **Reproducibility:** deterministic ingestion; pinned deps; clean commit history.

## 7. Constraints & decisions (locked)

- Stack: NestJS / TypeScript, Postgres + pgvector, Voyage embeddings (adapter), **Claude `claude-opus-4-8`** generation with native citations, Docker Compose. See `TDD.md` for rationale. No LangChain/LlamaIndex — a thin custom layer keeps full ownership of the retrieval/generation path (easy to reason about, debug, and adapt to a new corpus).
