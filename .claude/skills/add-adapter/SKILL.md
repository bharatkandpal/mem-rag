---
name: add-adapter
description: Scaffold a new embedding-provider, vector-store, or generation-provider adapter behind the project's swap interfaces. Use when adding/swapping an embedding model (Voyage, OpenAI, local), vector store (pgvector, Qdrant, …), or generation model/provider (Claude, OpenAI-compatible, local LLM), or when the user says "add an adapter", "swap embeddings", "swap the LLM", "support provider X". Keeps the EmbeddingProvider / VectorStore / GenerationProvider seams clean (TDD §2.1–2.2, §2.5) — the swap point that keeps providers pluggable (no vendor lock-in).
---

# add-adapter

Add a provider behind an interface, never inline. The swappable seam is a selling point — protect it.

## Steps

1. Identify which interface (`EmbeddingProvider`, `VectorStore`, or `GenerationProvider` — TDD §2.1–2.2, §2.5).
2. Create the new impl alongside the existing one (e.g. `OpenAIEmbeddingProvider` next to `VoyageEmbeddingProvider`; a new `GenerationProvider` next to `AnthropicGenerationProvider` / `OpenAICompatibleGenerationProvider`). Implement the full interface — don't widen it for one provider.
3. Wire selection through env (`EMBEDDING_PROVIDER`, `GENERATION_PROVIDER`, etc.) in the module's provider factory — call sites stay unchanged.
4. **Mind the dims.** If embedding dimensionality differs from the schema's `VECTOR(n)`, that's a migration + a re-ingest, not a drop-in. Flag it loudly.
5. **Mind citations.** A `GenerationProvider` without native citation support must report `supportsCitations: false` and return `citations: []` — never prompt-engineer a citation format as a substitute (rule `ai-and-secrets.md`). Faking verifiability is a bigger trust violation than admitting the provider doesn't have it.
6. Add a unit test for the new adapter; if it touches retrieval, run `run-evals` and report before/after; if it touches generation, run `answer-eval` and note whether `supportsCitations` changed.
7. Document the new env var in `.env.example`.

## Guardrails

- No provider-specific calls leak outside the adapter (rule `coding-standards.md`).
- New API keys go in env + `.env.example` only — never committed (rule `ai-and-secrets.md`).
