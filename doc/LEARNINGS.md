# Learning Log

> What I learned while building this, in a shape I can revisit and teach from.
> Distinct from `DESIGN_DECISIONS.md` (which records *why a choice was made*) and
> `codemap.md` (which is mechanical). One section per build slice; append as I go.
>
> Each entry: **Concept** (the idea) · **Why it matters** (the failure it prevents
> or the leverage it gives) · **How I handled it** (what the code does) ·
> **Explain it in one line** (the interview-ready narration — distil the best of
> these up into `collateral/interview-scripts.md` when prepping).

---

## GO-21a · Containerisation

### Multi-stage Docker builds throw away the toolchain
**Concept:** A `build` stage has the full toolchain (npm, the TypeScript compiler); only the compiled `dist/` + production `node_modules` are copied into a separate runtime stage. The build stage never ships.
**Why it matters:** Shipping build tools to production bloats the image and widens the attack surface for no runtime benefit.
**How I handled it:** Two stages in the Dockerfile; `COPY --from=build` pulls only the artifacts into the runtime image.
**Explain it in one line:** "The image that runs in prod contains only Node and my compiled app — the compiler stays in a discarded build stage."

### Distroless images trade debuggability for a smaller attack surface
**Concept:** A distroless runtime (`gcr.io/distroless/nodejs22`) contains Node + your app and nothing else — no shell, no package manager, no OS utilities — and runs as non-root.
**Why it matters:** Far fewer CVEs, and an attacker who lands in the container has no `sh`/`curl` to pivot with. The cost: you can't `docker exec` in to poke around, and a healthcheck can't shell out — it has to be an HTTP probe.
**How I handled it:** Runtime stage is distroless nonroot; health is an HTTP `GET /healthz`, not a shell command.
**Explain it in one line:** "I chose distroless for the security win and accepted that debugging is HTTP-probe-only, not shell-in."

---

## GO-21b · Embedding adapter

### The adapter (ports & adapters) pattern keeps providers swappable
**Concept:** Ingestion/retrieval depend only on a narrow `EmbeddingProvider` interface (`dims`, `embed()`), never on the word "Voyage". The concrete provider is one implementation behind the seam, selected by env in a factory.
**Why it matters:** Swapping the embedding model becomes a one-class change instead of a refactor — and it's the difference between "I wired up an API" and "I designed a system with no vendor lock-in."
**How I handled it:** `EmbeddingProvider` interface + `VoyageEmbeddingProvider` impl + env-driven factory module; call sites inject the token.
**Explain it in one line:** "Every consumer talks to the interface, so a new embedding model is a new class behind the same seam."

### Batch APIs don't guarantee response order
**Concept:** Embedding endpoints accept many inputs per call; the response may come back in a different order than sent (each item carries its own `index`).
**Why it matters:** Pair chunk 5's text with chunk 2's vector and you've silently corrupted retrieval — no error ever fires. This is a correctness bug a type system won't catch.
**How I handled it:** Re-sort the response by `index` before returning; unit-tested with a deliberately out-of-order mock.
**Explain it in one line:** "I tested order-preservation because it's a silent-corruption bug, not a crash."

### Design embedding as batch-first
**Concept:** `embed(texts: string[]) → number[][]`, not one string at a time. Embedding cost/latency is dominated by request *count*, not token count.
**Why it matters:** A per-chunk loop turns one fast batch call into N slow round-trips when ingesting a document.
**How I handled it:** The interface only exposes the batch shape, so callers naturally batch.
**Explain it in one line:** "The embedding seam is batch-first because the cost is per-request, not per-token."

### Don't log the API key (or anything that might echo it)
**Concept:** On an error, log the HTTP status — never the raw response body, which could echo the request including the key.
**Why it matters:** Secrets in logs are a real leak vector; logs get shipped, indexed, and shared.
**How I handled it:** Error messages include `status`/`statusText` only; the key lives in env and is never logged.
**Explain it in one line:** "Failures log the status code, never the body — the body can contain the key."

---

## GO-21b · Vector store

### `ON CONFLICT … DO UPDATE` is what makes ingestion idempotent
**Concept:** A `UNIQUE(doc_id, chunk_index)` constraint plus an upsert means re-ingesting the same corpus updates rows in place instead of inserting duplicates.
**Why it matters:** Without it, every re-index silently doubles your data — the same chunk appears 5×, crowding out everything else and corrupting retrieval.
**How I handled it:** `INSERT … ON CONFLICT (doc_id, chunk_index) DO UPDATE SET …`; tested the SQL contains the conflict clause.
**Explain it in one line:** "Re-ingestion is idempotent because the upsert keys on (doc_id, chunk_index), so chunks update in place."

### The storage engine's quirks stay inside the adapter
**Concept:** pgvector wants an embedding as the text `'[0.1,0.2,...]'` cast to `::vector`. That conversion lives only in `PgVectorStore`; the rest of the app passes plain `number[]`.
**Why it matters:** If the encoding leaked out, swapping to Qdrant/Pinecone would mean touching every call site. The seam keeps the quirk contained.
**How I handled it:** Encode + `::vector` cast inside `upsert`; the `VectorStore` interface speaks plain arrays.
**Explain it in one line:** "Call sites pass arrays; only the pgvector adapter knows the `'[…]'::vector` encoding."

### Batch the insert, don't loop
**Concept:** One `INSERT` with N value tuples beats N single-row inserts in a loop (same instinct as batch-first embedding).
**Why it matters:** A round-trip per chunk makes ingesting a large document painfully slow.
**How I handled it:** Build one parameterised multi-row insert with offset placeholders.
**Explain it in one line:** "Ingestion does one multi-row insert per batch, not a round-trip per chunk."

---

## GO-21b · Chunking

### Recursive structure-aware splitting keeps ideas intact
**Concept:** Split on the coarsest natural boundary that fits the budget — paragraph → line → sentence → word — instead of blindly slicing every N tokens.
**Why it matters:** Chunking is the single biggest lever on retrieval quality. Blind cuts sever sentences, which both embed worse and return incoherent passages.
**How I handled it:** A recursive `segment()` that descends a separator hierarchy, preserving separators so concatenation reproduces the source (no dropped text).
**Explain it in one line:** "I split at the coarsest natural boundary under budget, so chunks are whole ideas, not arbitrary slices."

### Overlap is carried context — and it changes the size invariant
**Concept:** Each chunk is seeded with the trailing ~`overlapTokens` of the previous one. The budget is measured on *new* content, so the real ceiling is `chunkTokens + overlapTokens`, not `chunkTokens`.
**Why it matters:** Overlap stops a fact that straddles a boundary from being lost to both chunks. And knowing the true bound (and testing it) is what separates "I used a chunker" from "I wrote one and know its limits."
**How I handled it:** Token-level seed via `tailByTokens`; the test asserts `≤ chunkTokens + overlapTokens` and that total tokens grow when overlap is enabled.
**Explain it in one line:** "Overlap carries boundary context, so each chunk holds up to CHUNK_TOKENS of new content plus the OVERLAP_TOKENS seed."

### "Token-aware" should mean a real tokenizer
**Concept:** Measure chunk size with an actual tokenizer (`gpt-tokenizer`), not a chars/4 heuristic — and wrap it so the tokenizer stays swappable.
**Why it matters:** Heuristic counts drift from what models actually see; a real count makes the budget honest. (It's still an *approximation* of Voyage's exact tokenizer, but it only governs budgeting, where consistency matters more than vendor-exact counts.)
**How I handled it:** `countTokens`/`splitByTokens`/`tailByTokens` in one `tokenizer.ts` wrapper.
**Explain it in one line:** "Chunk budgeting uses a real tokenizer behind a one-file wrapper, so 'token-aware' is literal and the tokenizer is swappable."

---

## Cross-cutting

### Grow the interface as you build, don't speculate
**Concept:** The `VectorStore` interface ships with only `upsert` now; `search` is added when retrieval is built — and can be eval-backed.
**Why it matters:** A stubbed `search` that throws is dead weight, and writing retrieval before there's an eval harness means tuning by vibes (which the project rules forbid).
**How I handled it:** Interface carries only what's implemented; a comment marks where `search` lands (RAG-21).
**Explain it in one line:** "I grow interfaces as features land rather than stubbing speculative methods I can't yet test."

### NestJS DI: depend on tokens, not concrete classes
**Concept:** Services inject DI tokens (`EMBEDDING_PROVIDER`, `VECTOR_STORE`) bound by factory providers; a `@Global` module exports the token so consumers don't re-import.
**Why it matters:** This is the mechanism that makes the adapter seams real at runtime — the orchestrator never names a concrete provider, so swapping one is a factory change.
**How I handled it:** Factory providers in `@Global` modules; tokens injected via `@Inject`.
**Explain it in one line:** "Wiring is by token, not class, so the swap seams hold all the way down to the DI container."

---

## GO-21b · Ingestion pipeline

### The orchestrator stays thin because the seams do the work
**Concept:** `IngestionService.ingest()` is just `load → chunk → embed → upsert`. It injects the loader and the two adapter *interfaces*, reads chunk sizing from config, and contains no provider- or storage-specific code.
**Why it matters:** All the hard parts (HTTP, SQL, tokenisation) live behind interfaces built earlier, so the pipeline reads like its own description — and swapping any piece doesn't touch it. This is the payoff for building the seams first.
**How I handled it:** A ~40-line service over `DocumentLoader` + `EmbeddingProvider` + `VectorStore`; unit-tested by mocking all three.
**Explain it in one line:** "The ingestion service is a thin orchestrator — the loader, embedder, and store are all interfaces, so it just sequences them."

### Unit tests pass ≠ the app boots — DI wiring is a separate failure mode
**Concept:** Mocked unit tests construct the service by hand, so they never exercise the Nest DI container. A missing provider or unresolvable token only fails at bootstrap.
**Why it matters:** You can have 100% green tests and an app that won't start. Catching it needs an actual boot (or a Nest `TestingModule`).
**How I handled it:** Built and booted the app with dummy creds and confirmed the DI graph resolved + routes mapped ("Nest application successfully started") before committing.
**Explain it in one line:** "I boot the app as a smoke check because green unit tests don't prove the DI graph resolves."

### pgvector's `<=>` is cosine *distance*, not similarity
**Concept:** The `<=>` operator returns cosine *distance* (0 = identical, 2 = opposite). Similarity, the intuitive "higher = closer" score, is `1 - distance`.
**Why it matters:** Get this backwards and your min-score floor rejects the *best* matches and keeps the worst. Ordering must be by distance ascending; the score you expose should be the converted similarity.
**How I handled it:** `ORDER BY embedding <=> $1` for the top-k, and `SELECT 1 - (embedding <=> $1) AS score` for the exposed similarity. Unit-tested the SQL shape and the numeric conversion.
**Explain it in one line:** "I order by pgvector's cosine distance but expose `1 - distance` as the score, because distance and similarity run opposite directions."

### Separate policy from mechanism: the store does top-k, the service owns the floor
**Concept:** `VectorStore.search` is a pure mechanism — "give me the k nearest." The min-score floor, the value of k, and the decision to return nothing are *policy*, and live in the retrieval service.
**Why it matters:** Keeping the store policy-free means a different store swaps in without re-implementing the floor, and the abstain behaviour (D5) has one clear home. Mixing them would scatter retrieval policy across layers.
**How I handled it:** `search(embedding, k)` returns scored hits; `RetrievalService` applies `MIN_SCORE` and returns `[]` when nothing clears it.
**Explain it in one line:** "The vector store just returns top-k; the floor and abstain policy live in the retrieval service, so storage stays swappable."

### Returning `[]` is a feature: it's what lets the system abstain
**Concept:** When no hit clears the floor, retrieval returns an empty list — and generation will treat that as "not in the corpus" rather than free-generating (D5).
**Why it matters:** A RAG system that answers when it retrieved nothing relevant fabricates. The empty result is the signal that makes grounding enforceable.
**How I handled it:** Floor filter can legitimately empty the result; tested that case explicitly.
**Explain it in one line:** "Empty retrieval is a designed outcome — it's the trigger for abstaining instead of hallucinating."

## GO-21d · Generation with citations

### Native citations beat "please cite your sources"
**Concept:** Instead of prompt-engineering the model to cite, pass each retrieved chunk as a `document` content block with `citations: {enabled: true}`. The API then returns citations as structured data — each cited span carries a `document_index` and the exact `cited_text`.
**Why it matters:** Prompt-based "cite your sources" is brittle — the model invents citation formats, miscounts, or cites things it didn't use. Native citations are the model pointing at *actual spans* of the documents you gave it; you can verify and render them. This is the core trust feature of a RAG product.
**How I handled it:** Each chunk → one document block (text source) with a title = its provenance; `document_index` maps the citation straight back to `chunks[i]`.
**Explain it in one line:** "I use Claude's native citations API — chunks go in as document blocks and citations come back as verifiable spans with an index into my chunks, not as model-formatted text."

### Abstain *before* the model call, not after
**Concept:** When retrieval returns nothing above the floor, return "not in the corpus" immediately — without calling the model at all.
**Why it matters:** A RAG system that free-generates on empty retrieval fabricates (D5). Short-circuiting before the API call makes abstention guaranteed (not dependent on the model behaving), and saves a token spend on a question we can't ground.
**How I handled it:** `generate()` checks `chunks.length === 0` and returns the abstain result; tested that the model client is never called in that path.
**Explain it in one line:** "Empty retrieval short-circuits to an abstain response before any model call — grounding is enforced in code, not hoped for from the prompt."

### Don't guess the SDK shape — consult the reference
**Concept:** The exact citation block shape (`source: {type: "text", media_type, data}`, `citations.enabled`, response `char_location` with `cited_text`/`document_index`) came from the `claude-api` capability, not memory.
**Why it matters:** LLM SDK surfaces drift; a plausible-looking guess silently fails or 400s at runtime — and this code can't be runtime-tested without an API key. Grounding the shape in current docs is the difference between "compiles" and "works".
**How I handled it:** Pulled the citations contract from the reference, pinned the model to `claude-opus-4-8`, and unit-tested the request/response shapes against it.
**Explain it in one line:** "I ground LLM SDK calls in the current API reference rather than memory, because the surface drifts and a wrong shape fails silently at runtime."

### Env vars are strings — coerce numeric config
**Concept:** `ConfigService.get('RETRIEVAL_K')` returns the string `"5"` when the env var is set, not a number; only the hard-coded default is a real number.
**Why it matters:** String config sneaks through loose comparisons and surfaces as subtle bugs later (e.g. `"5" + 1` = `"51"`). Coerce at the boundary.
**How I handled it:** A `toNumber(value, fallback)` helper that parses and falls back on non-finite — careful to let `0` through as a valid floor.
**Explain it in one line:** "I coerce numeric env config at the edge, because everything from the environment is a string."

---

## GO-21g · Retrieval eval harness

### The eval runner uses the real service — no mock intermediary
**Concept:** `NestFactory.createApplicationContext(AppModule)` spins up the full DI graph without an HTTP server, then resolves `RetrievalService` directly. The runner calls `retrieve()` in a loop and measures hit-rate + precision@k.
**Why it matters:** Using the real `RetrievalService` means the eval numbers reflect actual production behaviour — including the `MIN_SCORE` floor, the real embedding call, and the HNSW search. A mock would measure test scaffolding, not retrieval quality.
**How I handled it:** `app.get(RetrievalService)` inside a `createApplicationContext` bootstrap; `logger: false` suppresses Nest startup noise for clean output.
**Explain it in one line:** "The eval runner bootstraps the real NestJS DI graph and calls the production service — so the numbers are what prod would return, not what a mock says."

### Separate pure metric functions from the I/O-heavy runner
**Concept:** `computeMetrics` and `formatTable` live in `eval/metrics.ts` and are pure functions with no I/O, no NestJS, and no network. The runner (`run-eval.ts`) does the I/O — reads the dataset, calls the service, calls the metrics functions.
**Why it matters:** Pure functions are trivially unit-testable. Mixing the metric logic with the network calls would make testing require a live DB and Voyage key — slow, flaky, and not runnable in CI without secrets. The split means 7 unit tests cover all the metric edge cases (hit/miss, empty, multi-doc) with no real dependencies.
**How I handled it:** `metrics.ts` + `metrics.spec.ts` with no imports beyond the shared `RetrievedChunk` type; runner imports and calls them.
**Explain it in one line:** "Metric logic is in pure functions with unit tests; the runner is the thin shell that wires in real I/O."

### A separate tsconfig for files outside src/
**Concept:** The root `tsconfig.json` includes only `src/**/*`. The eval files live in `eval/`, outside that scope, so `ts-node` would fail to compile them without a second tsconfig. `tsconfig.eval.json` extends the root (inheriting `strict`, `emitDecoratorMetadata`, etc.) and adds `eval/**/*` to the includes.
**Why it matters:** You can't just add `eval/` to the root tsconfig — it's compiled by `nest build` for production and you don't want eval tooling in the production bundle. A separate tsconfig keeps the scopes clean.
**How I handled it:** `tsconfig.eval.json` extends `./tsconfig.json`, adds `eval/**/*`; `jest.config.js` adds `eval/` to `roots` so `metrics.spec.ts` runs with `npm test`.
**Explain it in one line:** "A separate tsconfig scopes ts-node to eval/ without polluting the production build — the production tsconfig never sees the runner."

### Exit code as a CI gate
**Concept:** If hit-rate falls below `EVAL_MIN_HIT_RATE` (default 0.5), the runner calls `process.exit(1)`. This makes `npm run eval` usable as a CI quality gate — a CI step can fail the build on a retrieval regression.
**Why it matters:** A printed number nobody reads is a vanity metric. A non-zero exit turns the number into a contract: retrieval quality is a requirement, not a suggestion.
**How I handled it:** Hit-rate is computed after the loop; compared against the env-configurable floor; `process.exit(1)` with a clear error message if below threshold.
**Explain it in one line:** "The eval exits non-zero on a regression so CI can gate on retrieval quality, not just print a number."

### Fail-fast config validation is a deliberate tradeoff
**Concept:** The embedding factory constructs the provider at startup, and the provider's constructor throws on a missing `VOYAGE_API_KEY`. So the whole app refuses to boot without the key — `/healthz` included.
**Why it matters:** Fail-fast surfaces a misconfiguration immediately instead of at the first `/ingest` call, but it couples *every* route's availability to the embedding key. For a demo where the key is required anyway, that's the right call; in a system where health must report during partial outages, you'd construct lazily instead.
**How I handled it:** Kept fail-fast (key required to boot); `.env.example` documents it. Noted as a conscious choice, not an accident.
**Explain it in one line:** "Missing keys fail at boot, not mid-request — a deliberate fail-fast tradeoff I'd revisit if health needed to survive a missing embedding key."
