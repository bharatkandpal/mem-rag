# Design Decisions (ADR log)

> The **why** behind the locked choices. PRD = what, TDD = how, this = why-and-what-else-we-considered. One entry per decision; append as new ones are made. Status: Accepted unless noted.

---

## D1 — Vector store: Postgres + pgvector
**Status:** Accepted
**Context:** Need a vector store for 1–10M chunks, demoable and credible as production infra.
**Decision:** Postgres with the `pgvector` extension, HNSW index.
**Alternatives:** Pinecone (managed, $50/mo min, fastest to prod), Qdrant (great free self-host), Chroma (fastest zero-to-working), Milvus (distributed scale).
**Why:** No extra service; transactional; the right answer at this scale; uses standard SQL tooling an integrator already has. Pinecone/Qdrant add ops + a dependency for no benefit at this scale.
**Consequences:** Single-node ceiling (~10M vectors) — fine for the demo; documented as a deliberate non-goal. Embedding dimensionality is pinned in the schema (`VECTOR(n)`), so swapping to a different-dim embedding model is a migration, not a drop-in.

## D2 — No RAG framework (no LangChain / LlamaIndex)
**Status:** Accepted
**Context:** Frameworks would speed up wiring but obscure ownership.
**Decision:** Thin, custom retrieval + generation layer over the Anthropic SDK and pgvector.
**Alternatives:** LangChain (LangGraph for orchestration), LlamaIndex (best-in-class retrieval).
**Why:** Full ownership of the retrieval and generation path keeps the system easy to reason about, debug, and adapt to a new corpus. A framework hides that logic behind abstractions for no benefit at this scope, and makes the pipeline harder to tune against the eval harness (D6).
**Consequences:** We own chunking, retrieval, and the prompt assembly — more code, but that's the point. Revisit only if scope grows past a single-purpose demo.

## D3 — Embeddings: Voyage behind a swappable adapter
**Status:** Accepted
**Context:** Anthropic doesn't provide embeddings; need a provider, and we want no lock-in to a single embedding vendor.
**Decision:** `voyage-3` as the default `EmbeddingProvider`, behind an interface; a second impl (OpenAI/local) keeps the seam honest.
**Alternatives:** OpenAI `text-embedding-3`, open-source local model.
**Why:** Voyage is the Anthropic-ecosystem recommendation; the adapter lets an integrator swap to OpenAI/local without touching call sites — provider choice stays theirs.
**Consequences:** One more API key (env-managed). Adapter dims must match the schema column (see D1).

## D4 — Generation: Claude `claude-opus-4-8` with native citations
**Status:** Accepted
**Context:** Need grounded answers that cite sources (PRD FR-4).
**Decision:** `@anthropic-ai/sdk`, model `claude-opus-4-8`, retrieved chunks passed as `document` blocks with `citations: {enabled: true}`.
**Alternatives:** Prompt-engineered "cite your sources" without the citations API (brittle); a cheaper model (weaker grounding).
**Why:** Native citations deliver grounded answers with source spans mapped back to chunks — far more robust than asking the model to self-cite, and the core trust feature for plugging the bot into a real workflow.
**Consequences:** Tied to the Anthropic citations contract; consult the `claude-api` capability for current SDK shapes rather than guessing.

## D5 — Abstain on empty retrieval
**Status:** Accepted
**Context:** A RAG system that free-generates when it finds nothing is worse than useless — it fabricates.
**Decision:** If no chunk clears the min-score floor, return "not in the corpus" — never generate an ungrounded answer.
**Why:** Grounding *is* the product. Abstention is a feature — it's what makes the chatbot safe to plug into a real workflow instead of a liability that confidently makes things up.
**Consequences:** Tuning the min-score floor matters — too high abstains on good questions, too low lets weak context through. This is exactly what the eval harness (D6) calibrates.

## D6 — Retrieval eval harness as a first-class deliverable
**Status:** Accepted
**Context:** "Shipped a RAG demo" vs "builds RAG infrastructure" is the whole positioning bet.
**Decision:** A labeled eval set + `npm run eval` reporting hit-rate / precision@k; the number lives in the README; retrieval changes must show before/after (rule `evals.md`).
**Why:** A quantitative quality number is the clearest objective measure of retrieval quality — it's what lets us tune chunking/k/index params with confidence and catch regressions before they ship.
**Consequences:** Ongoing cost to maintain the dataset; worth it. Pairs naturally with the structured-logging observability (TDD §3).

## D7 — Runtime & packaging: NestJS + Docker Compose
**Status:** Accepted
**Decision:** NestJS/TypeScript app; `docker compose up` brings up app + pgvector with one command.
**Why:** A mainstream, production-grade stack that integrators already know; one-command run is non-negotiable so anyone can plug in their documents and have it running without setup friction (PRD FR-7).
**Consequences:** Public deploy (GO-21f) needs a host with a pgvector-capable Postgres.

## D8 — Multi-agent orchestration is out of scope (this iteration)
**Status:** Accepted
**Context:** It's tempting to grow this into a multi-agent system.
**Decision:** Ship the focused RAG chatbot alone; multi-agent orchestration is a separate concern for a later iteration.
**Why:** Scope discipline — a polished, finished single-purpose product beats a half-built one trying to do too much. A pluggable RAG chatbot is independently valuable.
**Consequences:** Note it in the README's roadmap/future-work section so the direction is visible.
