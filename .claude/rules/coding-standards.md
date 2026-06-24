# Rule: coding standards

Binding conventions for this repo. Derived from TDD §2–3.

- **TypeScript + NestJS.** Modules per concern: `ingestion`, `retrieval`, `generation`, `eval`. No business logic in controllers.
- **Adapters are the swap points.** Anything touching an embedding model or vector store goes through the `EmbeddingProvider` / `VectorStore` interfaces (TDD §2.1–2.2). Never call Voyage or pgvector directly from ingestion/retrieval code — go through the interface so the seam stays real (no vendor lock-in).
- **No LangChain / LlamaIndex.** Thin, readable, owned code. If you're reaching for a framework, stop — that defeats the "I built the infrastructure" signal.
- **Tests with Jest.** Unit-test chunking + adapters; integration-test the `/query` happy path. A retrieval-affecting change without a test or eval is incomplete.
- **Structured logging** on ingest + query paths (latency + counts) — never `console.log`.
- **Config via `@nestjs/config`.** No magic constants for `k`, model IDs, or endpoints — read from env with sane defaults.
- **Keep `doc/codemap.md` current.** Adding/renaming/removing a function, class, module, route, or changing a signature means updating the codemap (via the `codemap` skill / `codemap-updater` agent) in the same change. If `git diff` touched `src/` but not `doc/codemap.md`, the change isn't done — the map is our impact-analysis tool for later edits.
