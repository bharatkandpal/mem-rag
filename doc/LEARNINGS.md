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

---

## Model swap + first live baseline (voyage-4-lite)

### A 429 is a rate window, not necessarily an empty tank
**Concept:** 429 Too Many Requests usually means a per-minute rate limit, not exhausted quota. The tell was in the structured logs: three back-to-back embed batches succeeded (one per second), then the fourth 429'd — a window, not a balance.
**Why it matters:** The wrong diagnosis buys the wrong fix. "Out of tokens" suggests switching models or buying credits; "rate-limited" demands backoff. Timestamped structured logs are what make the two distinguishable.
**How I handled it:** Read the success/failure pattern from the ingest logs before changing anything; the fix became retry-with-backoff, and the model switch happened for its own reasons (gen-4 recommended, quota headroom).
**Explain it in one line:** "Three successes then a 429 means a rate window, not an empty tank — I diagnosed it from log timestamps before picking the fix."

### Provider resilience belongs inside the adapter
**Concept:** Rate limits are a vendor quirk, so the retry logic (429/5xx → exponential backoff, honoring `Retry-After`, ~62s total across 5 retries = one full rate window) lives entirely inside `VoyageEmbeddingProvider`. Call sites are unchanged.
**Why it matters:** If ingestion or retrieval knew about retries, swapping providers would mean re-implementing resilience per caller. Behind the seam, a rate-limited ingest went from crashing at doc 4 to completing in 67s — with zero changes outside the adapter.
**How I handled it:** A private `postWithRetry` + a stubbable `sleep` (tests mock it — no fake timers); non-retryable statuses still fail fast, and error messages still never echo the key.
**Explain it in one line:** "The Voyage adapter rides out 429s with backoff internally, so the ingestion pipeline never learns what a rate limit is."

### Pin the embedding contract in the request, not in hope
**Concept:** The schema's `VECTOR(1024)` is a hard contract, so the adapter sends `output_dimension: 1024` explicitly (and the model is env-configurable via `VOYAGE_MODEL` instead of hardcoded). A same-dims model swap still means a full re-ingest — different models embed into different spaces — which the idempotent upsert handles by overwriting rows in place.
**Why it matters:** Model defaults drift; an implicit dims change would corrupt the store silently or fail at insert. And mixing vectors from two models is a correctness bug no error will ever surface — retrieval just quietly degrades.
**How I handled it:** `dims` drives the request param; D3 records the swap decision; re-ingest verified live (double ingest, row count stable at 9).
**Explain it in one line:** "The request pins output_dimension to the schema's 1024 and a model swap always re-ingests — vector spaces don't mix, and dims must never drift silently."

### A similarity floor is only as good as the eval that set it
**Concept:** Live probe: "What is the capital of France?" — clearly out-of-corpus — still had 1 of 5 hits clear the `MIN_SCORE=0.2` floor, so the code-level abstain (D5) never fired and the request went to the model. The floor was a guess, and the guess was wrong.
**Why it matters:** The abstain guarantee is the product's core trust feature, but it's enforced by a threshold — and an uncalibrated threshold fails invisibly: the system looks grounded right up until it confidently answers over junk context.
**How I handled it:** Tracked as RAG-57: calibrate the floor with before/after eval runs and seed `eval/answers.jsonl` with should-abstain cases, per rule `evals.md` — no vibes-tuning.
**Explain it in one line:** "An out-of-corpus question cleared our similarity floor — abstention is only as strong as the eval that calibrates the threshold behind it."

---

## Generalizing the generation seam (RAG-58-62, D4 update)

### A capability flag beats a fabricated fallback
**Concept:** Generalizing generation to any provider (Claude, OpenAI, a local model via Ollama) forced a real fork: Claude's native citations API has no equivalent on other providers. The tempting fix — prompt-engineer a citation format for everyone else — was exactly the approach the original Claude-only decision (D4) had already rejected as brittle, and it would be *more* brittle on a smaller local model, not less. Instead, `GenerationProvider` exposes `supportsCitations: boolean` as an honest capability flag; a provider without native support returns `citations: []`, never an imitation.
**Why it matters:** A fabricated citation is worse than an absent one — it's the exact shape of ungrounded confidence the whole abstain-on-empty design (D5) exists to prevent, just moved from "no context" to "no verifiable source." Generalizing an interface shouldn't mean quietly generalizing away a trust guarantee.
**How I handled it:** `supportsCitations` on the interface, `citationsSupported` threaded through to `QueryResult` so callers can render the difference instead of it being silently invisible; the constraint is documented at the interface, in the rule (`ai-and-secrets.md`), and in the `add-adapter` skill so the next provider doesn't quietly violate it.
**Explain it in one line:** "When I generalized the generation interface, the one thing that couldn't generalize was citation verifiability — so I made it an explicit capability flag instead of faking it uniformly."

### Policy lives above the seam, not inside each adapter
**Concept:** Abstain-on-empty-retrieval (D5) doesn't need the model at all — it's a decision made from the chunk count alone. So it stays in `GenerationService`, one layer above `GenerationProvider`; a provider is only ever invoked with a non-empty, already-filtered chunk list and never has to implement (or forget to implement) the abstain check itself.
**Why it matters:** This is the same split the store/retrieval seam already uses (`VectorStore.search` is pure top-k; `RetrievalService` owns the min-score floor) — recognizing the pattern meant the refactor had an obvious shape instead of an ad hoc one, and it guarantees every future provider gets abstain "for free," not as something each implementer has to remember.
**How I handled it:** `GenerationService.generate()` checks `chunks.length === 0` before ever touching `this.provider`; the provider interface has no abstain-related method at all, so there's nothing to get wrong.
**Explain it in one line:** "I looked for where this project already drew a policy/mechanism line — the vector store — and put the abstain check on the same side of that line for generation."

---

## The CLI wrapper (GO-21h, RAG-52-55)

### One pipeline, two entrypoints — the CLI is a client of the services, not of the API
**Concept:** The `rag` CLI doesn't call `POST /ingest`/`POST /query` — it bootstraps the Nest application context in-process (`NestFactory.createApplicationContext`, the same pattern the eval runner already used) and calls `IngestionService`/`GenerationService` directly. HTTP is just one transport over the pipeline; the CLI is another.
**Why it matters:** Shelling out to the API would have coupled the CLI to a running server and duplicated request/response handling; re-implementing the pipeline would have forked the logic. In-process reuse means every behavior — chunking, idempotent upsert, the abstain policy, provider selection — is identical across API, CLI, and eval harness by construction, not by discipline.
**How I handled it:** `src/cli/main.ts` is pure wiring (commander + app context); all output shaping lives in `src/cli/format.ts`, a dependency-free module that unit-tests without DI. The abstain answer passes through verbatim, and a non-citation provider gets an honest capability note — the CLI renders trust properties, it doesn't invent them.
**Explain it in one line:** "The CLI bootstraps the same Nest app context the eval harness uses and calls the services in-process — one pipeline, three entrypoints, zero duplicated logic."

### Verify what the blocker doesn't block
**Concept:** The live cited-answer check is blocked on Anthropic credits — but most of the CLI's surface isn't behind that blocker. `rag ingest` verified live end-to-end (4 docs → 9 chunks), and the abstain path was forced with `MIN_SCORE=0.99` — it fires *before* the provider call, so it proves the full CLI → retrieval → policy path with no model at all. Provider errors surface on stderr with exit 1.
**Why it matters:** "Blocked" is rarely binary. Decomposing the done-when into blocked vs. verifiable slices turned a stalled milestone into one with a single, well-scoped residual (re-run the cited-answer smoke after credits top-up) instead of a vague "couldn't test."
**How I handled it:** The env-tunable floor doubled as a test seam: raising it to 0.99 exercised abstain deterministically. The gibberish probe at the default floor also re-confirmed RAG-57 (junk still clears 0.2) — the calibration task now has two live data points.
**Explain it in one line:** "When the API was blocked, I verified everything in front of the API call — including forcing abstain via the score floor as a natural test seam."

---

## Calibrating the abstain floor (RAG-57)

### Measure the two distributions before picking a threshold
**Concept:** The floor was calibrated by printing raw top-k scores for every labeled in-corpus question next to six out-of-corpus probes (`eval/probe-scores.ts`, floor bypassed). In-corpus top-1 ranged 0.33–0.63; easy junk peaked at 0.22–0.25 — but a tech-adjacent question hit 0.37 and pure gibberish 0.355, both *above* the weakest legitimate question (0.331). The distributions overlap: no global floor can separate them.
**Why it matters:** The original 0.2 was a guess, and the replacement could easily have been another guess. Measuring first turned the decision from "pick a nicer-looking number" into "place a line where the data says the trade-off is" — and, more importantly, revealed that the perfect line doesn't exist, which is itself the finding.
**How I handled it:** `MIN_SCORE` 0.2 → 0.3: eval before → after: hit-rate 10/10 → 10/10, precision@5 0.42 → 0.43, abstain-rate 0/6 → 4/6. The two residual leaks are documented in the README and kept in the eval set as failing-honest entries — closing them is answer-level grounding's job (Claude answering only from documents), not the retrieval floor's.
**Explain it in one line:** "I printed the in-corpus and out-of-corpus score distributions side by side, put the floor where recall survives, and documented the overlap a similarity threshold can't fix."

### Should-abstain cases belong in the eval set, as their own metric
**Concept:** "Retrieval quality" was only being measured in one direction — does a real question find its chunks? The failure that actually bit (junk clearing the floor) was invisible to the harness. The dataset now encodes out-of-corpus questions as `relevant_doc_ids: []`, scored as a separate **abstain-rate** with its own CI gate (`EVAL_MIN_ABSTAIN_RATE`), rather than polluting hit-rate.
**Why it matters:** Folding abstain cases into hit-rate would have made both numbers lie (the README's "100%" would drop for the wrong reason). Two named metrics keep each number meaning one thing — and the abstain gate means a future floor/embedding change that reopens the leak fails CI instead of shipping silently.
**How I handled it:** `computeAbstain` beside `computeMetrics`; `formatTable` renders a separate should-abstain section; the runner gates on both rates independently.
**Explain it in one line:** "When a failure mode isn't measured, add it to the eval set as its own metric — a mixed-together number hides exactly the regression you built the harness to catch."

---

## The /query integration test (RAG-45)

### Integration-test the graph, mock the process boundaries
**Concept:** The test boots the *real* `AppModule` — controller, `GenerationService`, `RetrievalService`, config, validation — over actual HTTP (supertest), and replaces only the four things that cross a process boundary (embedder, vector store, generation provider, pg pool), each at its DI token. The adapter seams built for vendor-swapping turned out to be exactly the test seams.
**Why it matters:** Unit tests had each service right but nothing proved the wiring: module factories, token bindings, the controller's validation, and the abstain policy composing across services. This catches the class of bug where every part works and the whole doesn't — without needing Postgres or API keys in CI.
**How I handled it:** `Test.createTestingModule({ imports: [AppModule] })` + `overrideProvider(TOKEN)` for the four boundary tokens; asserts the cited happy path, the abstain path (provider verifiably never invoked), and 400s on bad input.
**Explain it in one line:** "The same DI tokens that make providers swappable make the app integration-testable — override exactly the process boundaries and run everything else for real."

---

## Production README (GO-22)

### One connection string cannot serve two network namespaces
**Concept:** `.env.example` shipped `DATABASE_URL=...@db:5432` — correct inside the compose network, wrong for every host-side tool (CLI, eval harness), which all needed a manual override. The fix: compose already injects its own `DATABASE_URL` for the container, so `.env` now carries the *host* view (`localhost:5432`) and each runtime gets the URL that's true for its own network namespace.
**Why it matters:** The quick start is part of the product — a README command that fails on first copy-paste costs more credibility than a missing feature. The same audit caught compose's `MIN_SCORE` fallback still at the pre-calibration 0.2: config duplicated across files drifts unless something forces a sweep.
**Explain it in one line:** "The container and the host see different networks, so the env file carries the host's truth and compose injects the container's — and every README command got run before it got written."

---

## RAG-56 — Local transformers.js embeddings (the swap seam, exercised)

### A min-score floor is calibrated per embedding model, not shared
**Concept:** Swapping Voyage → local bge-large held hit-rate at 10/10, but abstain-rate collapsed 4/6 → 0/6 at the same `MIN_SCORE=0.3` — every out-of-corpus question, gibberish included, cleared the floor. This wasn't a retrieval bug: bge's cosine similarities sit on a *higher, compressed* scale (in-corpus 0.61–0.73, junk 0.43–0.63) than Voyage's. Re-probing the distribution and moving the floor to 0.59 restored abstain-rate to 4/6 and lifted precision@5 to 0.50.
**Why it matters:** `MIN_SCORE` is an *absolute* cutoff, but a similarity score is only meaningful *within* one model's geometry — so the floor is a property of the (model, corpus) pair, not a portable constant. Treating it as shared is exactly how an embedding swap silently stops abstaining while every "quality" number still looks green. The abstain-rate metric + CI gate (RAG-57) is what caught it.
**How I handled it:** re-ran `eval/probe-scores.ts` under the new provider for raw top-k scores, set the floor inside the (gibberish 0.583, weakest-legit 0.608) window, re-ran the eval to confirm, and documented both floors (0.3 Voyage / 0.59 bge) in `.env.example`, the README, and the codemap env table. Ran the whole experiment against an isolated `rag_bge` database so the live Voyage corpus was never overwritten.
**Explain it in one line:** "Swap the embedding model and the abstain threshold moves with it — cosine floors don't transfer across models, so re-probe and re-calibrate every time, and let the abstain-rate gate prove it."

### Keep a heavy, ESM-only dependency out of module load and out of tests
**Concept:** `@huggingface/transformers` is ESM-only (this project is CommonJS) and fetches ~130 MB of ONNX weights on first use. Instead of importing it at module top-level, the provider takes an injectable `PipelineLoader` and `await import()`s the package lazily on the first `embed()` — the package ships a CJS node bundle, so require-of-ESM resolves cleanly under Node 22. Unit tests inject a fake loader and never touch the network or the real model.
**Why it matters:** A top-level import would download weights the first time the DI graph boots (including under `jest`), couple the module to one runtime's ESM/CJS interop, and make the adapter untestable offline. The loader seam keeps boot cheap, tests hermetic, and the interop contained to a single function.
**Explain it in one line:** "Inject the loader for a heavy/ESM-only dependency so its cost — download, native binary, interop — stays lazy and mockable, and the adapter stays unit-testable with no network and no weights."

---

## Wiring the chat UI onto the existing setup (GO-21e)

### Serve the SPA from Nest — one origin, no build, no CORS
**Concept:** The chat UI is a single `web/public/index.html` served by the app itself via `app.useStaticAssets(join(__dirname,'..','web','public'))` (needs `NestFactory.create<NestExpressApplication>`, already have `@nestjs/platform-express`). Same origin as `POST /query`, so `fetch('/query')` needs no CORS and the one-command `docker compose up` still yields a working UI at `/`. The distroless image bakes it in (`COPY web/public`), and a `:ro` bind-mount lets the HTML be edited + reloaded without a rebuild. No React/Vite toolchain was needed to satisfy "runs with the existing setup."
**Why it matters:** The `/query` contract already returned everything the UI needs (`answer`, `citations[]`, `chunks[]`, `abstained`, `citationsSupported`); the UI is a thin renderer. Citations have a `citedText` source span + `documentIndex` but no answer offset, so the honest rendering is a **References panel** (per-citation source + quote, plus "Also retrieved" chunks), not fabricated inline markers.

### The bug was auth, not code: recreate to re-read `.env`
**Concept:** `/query` was 500-ing with Anthropic "Could not resolve authentication method" while Voyage embeddings + pgvector search worked fine — retrieval was healthy, only generation failed. The container had been up 7 days with an empty `ANTHROPIC_API_KEY`; `docker compose up -d --force-recreate app` made Compose re-interpolate `${ANTHROPIC_API_KEY:-}` from `.env` and citations flowed.
**Why it matters:** A long-lived container silently holds the env it started with. When an LLM call fails auth, check the *running* container's environment before the code — and remember the layered read: retrieval green + generation red points straight at the generation provider's key.
**Explain it in one line:** "The code was fine; the 7-day-old container just never got the key — recreating it re-read `.env`."

---

## An opt-in escape hatch for the grounding guarantee (UI + `/query/general`)

### Honour "give me a general answer" without weakening abstain — make the exception explicit, not silent
**Concept:** The product rule is *abstain on empty retrieval, never free-generate* (D5, `ai-and-secrets.md`) — "grounding is the whole product." A UI ask for "answer it from general knowledge anyway" is in direct tension with that. Resolved by keeping the default `GenerationService.generate` / `POST /query` abstain **completely untouched** and adding a **separate, user-initiated** path: a new `generateGeneral` on the `GenerationProvider` seam (so the model SDK is still only ever touched behind the adapter), a `GenerationService.generateGeneral` that bypasses retrieval entirely, and a distinct `POST /query/general` route. The result carries a new `grounded: boolean` on `QueryResult`; the UI renders `grounded:false` as an amber, clearly-labelled "general knowledge · not from your corpus" card, reachable only via a button that appears *after* an abstain.
**Why it matters:** A binding rule that says "the whole product" isn't a reason to refuse a legitimate product need — it's a constraint on *how* you satisfy it. The escape hatch is defensible precisely because it's explicit (its own route + method), opt-in (never automatic), and visible (colour-coded, no citations, `grounded:false`) — the opposite of the silent free-generation the rule forbids. The rule doc was updated in the same change so code and rule can't drift.
**Explain it in one line:** "Grounding stays the default and the guarantee; the ungrounded answer is a separate, labelled, opt-in door — not a hole in the wall."

---

## Running the whole stack key-free — the container blocker was the weight cache (RAG-67 slice)

### Both adapters already existed; "fully key-free" was a packaging + one real bug
**Concept:** Local embeddings (`transformers`, RAG-56) and local generation (`openai-compatible` → Ollama, RAG-60) already shipped behind their seams, so key-free looked like pure config: a `docker-compose.local.yml` overlay that swaps both providers, blanks `ANTHROPIC_API_KEY`/`VOYAGE_API_KEY`, and sets the model-specific floor (`MIN_SCORE=0.59` for bge-large, not Voyage's `0.3`). But `EMBEDDING_PROVIDER=transformers` **crashes in the shipped container**: transformers.js caches weights under `node_modules/@huggingface/transformers/.cache`, which is **read-only for the distroless `nonroot` (uid 65532) user**. Fix: make the cache path configurable (`TRANSFORMERS_CACHE` → `env.cacheDir` in the loader) and point it at a writable, persistent volume.
**Why it matters:** The seams did their job — no generation/embedding code changed — but "swappable" only counts if the *deployed runtime* can actually run the swap. A local model needs writable disk (weight cache) and network on first pull; a hosted API needs neither. The distroless choice (minimal CVEs, nonroot) that's great for the Claude/Voyage image is exactly what makes an in-container local model fall over. Test the alt adapter **in the production image**, not just on the host.

### A Docker named volume is root-owned unless the image's mountpoint says otherwise
**Concept:** Mounting a fresh named volume at `/cache` gave the nonroot process `EACCES` — Docker creates the volume's mountpoint `root:root` by default. The trick: **pre-create the directory in the image owned by the target uid** (`mkdir` in the build stage, then `COPY --from=build --chown=65532:65532 /hf-cache /hf-cache` into the distroless runtime). Docker initializes an empty named volume from the image directory at that path, **inheriting its ownership** — so the volume lands `nonroot`-owned and writable. (`/tmp` is world-writable and works too, but isn't persistent across a container recreate → re-downloads ~335MB.)
**Why it matters:** "Add a volume for the cache" is a one-liner that silently fails for any non-root container. The ownership has to be seeded from the image; the mount alone won't grant it. This is the general recipe for a writable persistent path in a nonroot/distroless container.

### Different embedders ⇒ different vector spaces ⇒ a re-ingest, not a migration
**Concept:** Switching an existing DB from Voyage to transformers didn't need a schema change (both 1024-dim) but **did** need a full re-ingest + `TRUNCATE` — the two models' vectors aren't comparable, and the dims assertion can't catch it (same 1024). Re-ingesting `eval/sample-corpus` keyless (Voyage key blanked) proved local embeddings, and left a clean sample-corpus-only DB that the eval reproduces on: hit-rate **10/10**, abstain **4/6** (gate green), precision@5 **0.46** — within noise of RAG-56's 0.50.
**Why it matters:** "Same dimensionality" is a trap — it makes an incompatible swap look free. Embedding-space identity, not just dims, is what lets vectors coexist; when it changes, the corpus has to be rebuilt. Documented so nobody runs the default profile over a locally-embedded DB and gets silent garbage retrieval.
**Explain it in one line:** "Key-free wasn't new code — it was a writable weight-cache in a nonroot container, a nonroot-owned volume, and a re-ingest because the vectors don't transfer."

## Observability without touching call sites (RAG-63)

### `AsyncLocalStorage` + `app.useLogger` = correlation IDs with zero call-site edits
**Concept:** Every path already logged counts+latency via per-class `new Logger(name)` (RAG-42). To make those lines correlated, I did **not** thread a request id through signatures. Instead: an HTTP middleware opens an `AsyncLocalStorage` scope per request (honoring an inbound `x-request-id`, else `randomUUID()`), and a `CorrelatedLogger extends ConsoleLogger` reads the id from ALS and prefixes each line. Registering it via `app.useLogger(new CorrelatedLogger())` works because Nest's per-class `Logger` instances **delegate to the logger registered at bootstrap** — so ~40 existing log calls became correlated with one line of wiring. The live smoke proved it: one `POST /ingest` emitted `[smoke-ingest-1]` across `TransformersEmbeddingProvider` → `PgVectorStore` → `IngestionService`, threading through the whole async chain.
**Why it matters:** ALS is the Node answer to "thread-local for async" — it propagates across `await` without a parameter. The `useLogger`-delegation trick means cross-cutting log context is a bootstrap concern, not a per-call-site edit. That's the difference between "add tracing" being an afternoon vs. a refactor.

### prom-client: a dedicated `Registry`, and start default collectors in a lifecycle hook, not the constructor
**Concept:** Two test-hygiene decisions. (1) `MetricsService` builds its own `new Registry()` instead of prom-client's global default — otherwise a second instance (a second test, a second app) throws "metric already registered". (2) `collectDefaultMetrics()` runs in `onModuleInit`, **not** the constructor, because its gc/event-loop collectors hold live process handles; keeping them out of the constructor means unit tests that `new MetricsService()` never leak a handle. `--detectOpenHandles` on the full suite confirmed zero leaks even though the integration test boots the whole app with collectors running.
**Why it matters:** A metrics registry is global mutable state; treating it as an owned, injected instance (not a singleton import) is what makes it testable. And "side effects with handles belong in lifecycle hooks, not constructors" is the general rule that keeps a DI graph safe to instantiate in a test.

### HTTP request metrics belong in an interceptor, not middleware — cardinality
**Concept:** `route` is a Prometheus label, so it must be the *templated* path (`/query`), never the raw URL. A Nest **interceptor** only fires on matched controller routes, so the static UI served from `web/public` never reaches it — bounded label set. Raw Express middleware would see every asset URL and explode the series. (Correlation stays middleware — it's label-free and must wrap the whole lifecycle, including the error path the interceptor sits inside of.) Recorded on the response `finish` event so the status is the final code (Nest's 201-for-POST, or a 5xx the filter set), not a not-yet-applied value.
**Why it matters:** High-cardinality labels are the classic way to kill a Prometheus server. The interceptor-vs-middleware choice is really a cardinality-vs-coverage choice, and picking the layer is the design.

### A global exception filter must *enrich*, not *replace* — and only 5xx is an "error"
**Concept:** A `@Catch()` filter intercepts every error response, so the naïve `{statusCode, message, correlationId}` body would have **clobbered** intentional payloads — `/healthz`'s `{db, pgvector}` 503 diagnostics and validation's field messages. The rule: for an `HttpException`, pass its own `getResponse()` body through and only *add* `correlationId`; only for an unexpected (non-HTTP) error return a generic `Internal server error` (real message/stack to the log, never the client — no leak). And `rag_errors_total` increments **only when `status >= 500`**: 4xx validation and abstain (a 200) are expected control flow, not faults. Smoke-verified: forced 500 → generic body + `rag_errors_total{type="TypeError"}` + correlated ERROR log; a 400 kept its validation payload, gained `correlationId`, and did **not** bump the counter.
**Why it matters:** "Abstain is a success, not an error" is a product invariant (D5) that has to hold in the metrics too, or the error rate lies. And a catch-all filter is a foot-gun: it owns *all* error responses, so preserving intentional ones is a correctness requirement, not politeness.

### Injecting a cross-cutting service `@Optional()` keeps unit tests decoupled
**Concept:** The feature services (ingestion/retrieval/generation) record domain metrics, but I injected `MetricsService` as `@Optional()` and guarded calls with `this.metrics?.record…()`. In the app it's always present (the module is `@Global`); in a unit test that constructs the service by hand it's simply `undefined` and the optional-chain short-circuits — so **not one existing service spec needed rewriting** to add metrics.
**Why it matters:** Observability is genuinely optional to the business logic, so the type says so. Optional injection is how you add a cross-cutting concern to already-tested units without churning their tests — the seam pays for itself immediately.
**Explain it in one line:** "Tracing rode in on ALS + `useLogger` (zero call-site edits), metrics on an owned registry recorded via `@Optional` seams, and the catch-all filter *enriches* error bodies instead of replacing them — counting only real 5xx faults, never abstain."

## Plug-and-play key-free bundle: one `docker compose up`, no keys (RAG-67)

### First-boot orchestration is declarative — one-shot services + `service_completed_successfully`
**Concept:** "Fresh boot answers a query out of the box" needed three things to happen in order before the app is useful: the DB up, the generation model pulled, and the corpus ingested. I did **none** of it with entrypoint scripts or wait-loops. Two one-shot services — `ollama-pull` (`entrypoint: ["ollama","pull","qwen2.5:3b"]`, `OLLAMA_HOST` pointed at the server container so it downloads into the shared volume) and `seed` (the app image with `command: ["dist/cli/main.js","ingest","/app/eval/sample-corpus"]`) — plus `app.depends_on` with `condition: service_completed_successfully` on both (and `service_healthy` on `db`/`ollama`). Compose then runs the whole ladder in order and only starts the app once the model and corpus are ready. Live-verified: cold boot → `Ingested 4 docs → 9 chunks` → grounded `/query` with zero manual steps.
**Why it matters:** `depends_on` conditions turn startup ordering into data, not a shell script. One-shot "job" services (`restart: "no"`, run-to-exit) are the Compose-native way to express init steps, and gating dependents on their *successful completion* is what makes a bundle self-seeding instead of "up, but empty until you ingest."

### The seed job is the CLI, not new code — and it inherited tracing for free
**Concept:** The first-boot seed reuses the exact in-process ingestion path the CLI already exposes (RAG-53) — the seed service *is* the app image with an overridden `command`. No seed script, no duplicated pipeline logic, no HTTP round-trip. A bonus fell out of it: the seed's logs came through already carrying correlation IDs (`[fb0b5882-…]`), because the CLI wraps its command body in the same ALS scope RAG-63g added — cross-cutting work done in one track showed up in another for free.
**Why it matters:** "Reuse the in-process service seam, never fork the pipeline" (the CLI/HTTP/MCP thesis) pays off again: a new *entrypoint* (a compose job) costs a `command:` line, not a code path. Seams compound.

### Standalone cloud file, not an overlay — because Compose *merges* `depends_on`
**Concept:** I wanted the key-free stack as the default `docker compose up` and the cloud stack (Voyage + Anthropic, native citations) as opt-in. The tempting shape — a `docker-compose.cloud.yml` overlay that just overrides the app's env — breaks: Compose **list-merges** `depends_on`, so an overlay can't *remove* the app's `ollama-pull` gate, and the cloud path would drag in a 2GB model server it never uses. So cloud is a **standalone** file (`docker compose -f docker-compose.cloud.yml up`), which costs ~12 lines of duplicated `db` config but keeps each profile internally coherent and free of the other's services. Keys are enforced with `${VOYAGE_API_KEY:?message}` so the cloud path fails fast with a helpful error instead of silently running unauthenticated.
**Why it matters:** Override files merge some keys and replace others; `depends_on`, `volumes`, and `command` merge in ways that make "subtract a service via overlay" impossible. When two configs differ in their dependency graph — not just scalar env — a standalone file beats a clever overlay.

### Long `docker compose up` must be a first-class background job — not `nohup … &` inside one
**Concept:** The first live run tore the whole project down mid-boot with a `No such container` error. The cause wasn't the compose — it was launching `nohup docker compose up -d & ` *inside* a harness background task. Compose's `up` blocks waiting on `service_completed_successfully` deps; when the harness reaped the launcher shell it signalled the detached child, and Compose responds to an interrupt during `up` by **aborting and cleaning up the project**. Re-running the identical command as a direct harness-tracked background job (no `nohup`, no `&`) completed cleanly.
**Why it matters:** `docker compose up` is an *orchestrator that owns its containers for the duration* — a signal to it is "tear down," not "detach." Anything that can deliver it a stray signal (a reaped parent, a closed terminal) will nuke the stack. Give long-running orchestrators a real supervised process, don't double-background them.
**Explain it in one line:** "One key-free `docker compose up`: bundled-Ollama + first-boot seed wired as one-shot jobs gated by `service_completed_successfully`, the seed *is* the CLI (so it got correlation IDs for free), cloud is a standalone file because `depends_on` merges — and never `nohup` a `compose up`, a stray signal tears the project down."

## Chat UI scaffold: a separate `web/` package behind a Vite dev proxy (GO-21e-b)

### The UI is its own npm package, not folded into the Nest project
**Concept:** `web/` has its own `package.json`, `node_modules`, lockfile, and toolchain (Vite + React + ESLint 9 flat config + Prettier) — deliberately not merged into the root Nest `package.json`. The two have incompatible module/lib settings (Node CJS-ish + `nest build` vs. browser ESM + `jsx: react-jsx`, DOM libs) and separate dependency graphs; one root `tsconfig`/`node_modules` for both would mean constant lib/`types` collisions. Same-repo, separate package.
**Why it matters:** A build-tool boundary is cheaper to keep than to remove. The seam also mirrors how it ships: dev is two servers (Vite proxying Nest), prod is one (Nest serves the built assets, GO-21e-g) — the split is real, not incidental.

### `server.proxy` makes the browser same-origin in dev — no CORS anywhere
**Concept:** Vite's `server.proxy` forwards `/query` (a prefix, so `/query/general` too), `/healthz`, `/metrics` to `http://localhost:3000`, so the dev browser only ever talks to `localhost:5173` and the app needs no CORS config — matching prod, where Nest serves UI + API on one origin. `publicDir:false` was essential: the repo already has `web/public/` (the vanilla prototype Nest serves today), and Vite's default would have claimed that folder as its static dir.
**Why it matters:** Keeping dev same-origin means the CORS story is "there isn't one" in both dev and prod — one less thing to get wrong or to diverge between environments. When adding a build tool to a repo that already used a directory it has conventions about (`public/`), check for the collision.

### `noEmit` + project references fight; one tsconfig is simpler than the template's two
**Concept:** The stock Vite react-ts template splits `tsconfig` into app + node projects via references, which requires `composite:true` — and `composite` forbids `noEmit`, so `tsc --noEmit` errors `TS6310` ("referenced project may not disable emit"). Rather than fight it, I collapsed to a single `web/tsconfig.json` covering `src` + `vite.config.ts`, with `types:["node","vite/client"]` so the Node-side config file (`__dirname`) typechecks. Typecheck is a plain `tsc --noEmit`.
**Why it matters:** Project references buy incremental builds this app doesn't need yet; the default template optimizes for a scale that isn't here. Fewer configs = fewer failure modes. Reach for references when build time hurts, not by default.
**Explain it in one line:** "`web/` is its own package (browser ESM ≠ `nest build`); a Vite `server.proxy` keeps dev same-origin so there's no CORS; `publicDir:false` protects the legacy prototype; and a single tsconfig sidesteps the template's `composite`-vs-`noEmit` fight."

## Migration runner: the single schema authority (RAG-46)

### initdb-only isn't "no migrations yet" — it's a bootstrap that silently stops working
**Concept:** The `db/init/*.sql` mount is applied by Postgres' `docker-entrypoint-initdb.d` **only when the data directory is empty** — first boot of a fresh volume. It never re-runs on an existing volume, and a managed Postgres / k8s cluster has no such mount at all. So it looks like a migration system in local dev (fresh `down -v` → schema appears) while providing nothing for the two cases that matter: an evolving local DB and deploy. RAG-46 replaced it with a real runner (`src/database/migrate.ts`): read `db/migrations/*.sql` sorted, skip versions already in a `schema_migrations` ledger, apply the rest — each file **and its ledger insert in one transaction**, so a failed migration commits neither. I made `db/migrations/` the *single* schema authority (moved `001_init.sql` there, deleted the initdb mount) rather than keeping both — dual sources drift, and the skill's own rule is "keep the schema in one place."
**Why it matters:** "It works on a fresh `docker compose up`" is exactly the test that hides an initdb-only gap. The moment you have data you don't want to drop, or a target without the initdb hook, the bootstrap is a no-op. Track applied versions in-DB or you don't have migrations, you have a first-run fixture.

### The runner is a standalone entrypoint, not app-on-boot — because deploy runs it *before* the app
**Concept:** I made migration a one-shot `node dist/database/migrate.js` — its own npm script, its own compose service (`restart: "no"`, gated `service_completed_successfully`, seed + app wait on it), and baked into the image (`COPY db/migrations`) so it needs no repo checkout. No `NestFactory`; just a `pg` `Pool` reading `DATABASE_URL`. The alternative — run migrations inside `main.ts` before `app.listen` — couples "schema is current" to "a web process started," which breaks the moment you want a k8s Job / init-container (RAG-64) or multiple app replicas racing the same DDL. A standalone step maps 1:1 onto every deploy primitive: a compose one-shot, a k8s Job, a Fly release_command.
**Why it matters:** Migrations are an *ordering* concern between the DB and everything that reads it — a phase, not a line of app startup. Expressing it as a separate run-to-exit step (the same pattern as the `seed`/`ollama-pull` jobs) is what lets `depends_on` sequence db → migrate → seed → app declaratively, and it's the shape every orchestrator already understands.
**Explain it in one line:** "initdb-only is a fresh-volume fixture, not migrations (it never re-runs and deploy has no such hook); a real runner tracks applied versions in a `schema_migrations` ledger and runs each file+insert transactionally, shipped as a standalone one-shot entrypoint so db → migrate → app is declarative `depends_on`, reusable as a k8s Job."

## Dependency pinning: the lockfile is the guarantee, the manifest is the intent (RAG-47)

### A committed lockfile already gives reproducibility — pinning `package.json` closes a different gap
**Concept:** With `package-lock.json` committed, `npm ci` installs the exact resolved tree regardless of the caret ranges in `package.json` — so reproducibility was already covered before this slice. What the carets still allowed was **drift on a plain `npm install`** (a fresh `^10.4.4` could pull `10.4.99`) and a lockfile that could be silently regenerated to newer minors. I pinned both manifests (root + `web/`) to the versions the lockfile *already* resolved, so the manifest now states exactly what ships. Because the targets were the installed versions, `npm install --package-lock-only` reported "up to date" and the lockfile diff had **zero `"version":` changes** — only the recorded ranges tightened. Verified with `npm ci --dry-run` + typecheck on both packages.
**Why it matters:** "We have a lockfile" and "our deps are pinned" are different claims. The lockfile makes *CI* reproducible; exact manifests make the *intent* auditable and stop `npm install` (which contributors run, not just CI) from quietly moving versions. Pinning to the resolved set is a no-op install by construction — the safe way to tighten, since you're only ever narrowing a range around a version you already run.
**Explain it in one line:** "A committed lockfile makes `npm ci` reproducible, but carets still let `npm install` drift; pinning the manifest to the already-resolved versions makes intent explicit with a zero-diff, no-op install (verified by `npm ci --dry-run` + typecheck)."

## Chat UI: design tokens + AppShell (GO-21e-c)

### Tokens as CSS custom properties, themed by one attribute on `<html>`
**Concept:** The whole palette/scale lives in `web/src/styles/tokens.css` as `--*` custom properties, with a `:root[data-theme='dark']` block overriding only the colors. Components reference tokens exclusively — no raw hex — so a theme is a single attribute flip on the root element (no per-component conditionals, no theme prop threaded through the tree). A pre-paint inline script in `index.html` resolves the theme from `localStorage`/`prefers-color-scheme` *before* first paint; `useTheme` then reads that back so React state agrees with what's already on screen and takes over persistence. This is what avoids a flash of the wrong theme without SSR.
**Why it matters:** CSS variables cascade, so theming is free at every depth — the alternative (a JS theme object passed via context and interpolated in each component) couples every component to the theme system. The pre-paint script is the standard fix for the FOUC that a React-only theme toggle always has: the DOM must be right before hydration, and only inline head JS runs that early.

### `⌘/Ctrl+Enter` to send keeps the composer genuinely multiline
**Concept:** The composer is a `<textarea>`, and *plain Enter inserts a newline* — sending is `(metaKey||ctrlKey)+Enter`. Auto-grow is a `useLayoutEffect` that resets height to `auto` then sets it to `scrollHeight` (capped), measured synchronously before paint so there's no visible jump. Autofocus fires on mount and again whenever the box is re-enabled after a query, so the cursor is always ready (the <60s-to-first-answer goal).
**Why it matters:** Chat UIs that send on bare Enter can't accept multi-line questions without a mouse. Making send the explicit shortcut is the small correctness call that keeps the input honestly multiline. `useLayoutEffect` (not `useEffect`) is the right hook for DOM measurement that must land before the browser paints.

### The reducer encodes phases; the two answer sub-cases are derived at render, not stored
**Concept:** `state.ts` is a `useReducer` with `phase: empty|loading|answered|abstained|error`. Abstain is its own phase (dispatched by reading `result.abstained` in the `success` action), but the *grounded* vs *uncited-honest* split — both `answered` — is left to render time, computed from `citations.length` + `citationsSupported`. State stores the `QueryResult`; it doesn't pre-classify what the components can read directly.
**Why it matters:** Don't fan state out into flags a component can derive — every derived boolean in state is a chance for it to disagree with the data it came from. Store the source (`QueryResult`), branch at the leaf. Abstain earns a phase because it changes the whole layout (no sources panel); the citation sub-cases only change one region, so they stay derived.
**Explain it in one line:** "Themes are one `data-theme` attribute over CSS-variable tokens (+ a pre-paint script to kill FOUC); the composer sends on ⌘/Ctrl+Enter so Enter stays a newline; and the reducer stores the `QueryResult` + a coarse phase, deriving the grounded/uncited split at render instead of duplicating it in state."

## Chat UI: persisted question-history drawer (GO-21e-i)

### A scope revisit, recorded — not a silent contradiction of the guide
**Concept:** The design guide §8 explicitly *deferred* history persistence; the user then asked for a burger-menu history. Rather than just build it, the decision was reinstated **in the guide** (§2 layout, §4 inventory, §8 revised with a dated note) and framed precisely: a **navigable list of independent Q&As persisted to localStorage**, NOT multi-turn conversation memory. The backend `/query` stays single-shot and stateless; the drawer only re-displays a stored `QueryResult`.
**Why it matters:** When a new instruction reverses a written design decision, the fix is to *amend the record*, not to leave the doc and the code disagreeing. The tight framing ("history of independent Q&As, not chat memory") also kept the change from dragging in server sessions / conversation context the product deliberately doesn't have.

### History reshaped state from "one result" to "list + activeId" — cheaply, because branches were derived
**Concept:** Going from a single current result to a persisted history meant reshaping `AppState` from `{result}` to `{history: Exchange[], activeId}`. That was a small edit precisely because the render branch was already *derived* (`phaseOf(activeExchange)`), not stored: the components read `phase` + `QueryResult` the same way whether the result is "the latest" or "the one you clicked in the drawer." Persistence is one effect (`saveHistory` on `history` change) + a lazy reducer init (`loadHistory`), filtering to completed results only (no pending/errors persisted).
**Why it matters:** The GO-21e-c decision to *derive* the phase instead of storing flags paid off one slice later — the state could grow from scalar to list without touching how anything renders. Deriving over storing is what makes state reshapes cheap.

### The drawer overlays; it doesn't restructure the layout
**Concept:** The history drawer is `position: fixed` with a backdrop and a `translateX(-100%)` → `0` slide, rendered by `App` as a sibling of `AppShell` — not a new grid column. Collapsed by default, it leaves the centered single-column shell byte-for-byte unchanged; open, it floats above with an Esc/backdrop close. So the guide's "single-column, citation-first" layout is intact and the history is purely additive.
**Why it matters:** An overlay drawer adds a feature without renegotiating the whole layout (no grid-template rework, no reflow of the conversation column). When a late addition risks disturbing a settled layout, floating it above the existing structure is lower-risk than threading a new region through it.
**Explain it in one line:** "History came in as an amendment to the guide (persisted list of independent Q&As, not chat memory), reshaped state from one-result to list+activeId almost for free because the render branch was already derived, and rides as a fixed overlay drawer so the single-column shell is untouched when it's closed."

## Chat UI: the query happy path — Conversation / Message / AnswerBody / LoadingAnswer (GO-21e-d)

### One active exchange, not an accumulating thread — the history model already decided this
**Concept:** `Conversation` renders the *active* exchange as exactly one user turn + one assistant turn, not a growing multi-message scroll. That's a direct consequence of the GO-21e-i history model (a navigable list of independent Q&As): the drawer is the "which question" selector, so the main pane only ever shows one Q→A at a time. It reads `phaseOf(active)` and switches the assistant side: `LoadingAnswer` while pending, `AnswerBody` when answered/abstained, an interim line on error.
**Why it matters:** The guide's original "scrollable message list" assumed a chat thread; once history became a drawer of independent questions, a thread would misrepresent a stateless single-shot backend as a conversation with memory. Rendering one exchange keeps the UI honest about what `/query` actually is. Design decisions cascade — the history shape settled the conversation shape.

### AnswerBody renders plain text now but is the seam for citation markers later
**Concept:** GO-21e-d deliberately renders the answer as plain paragraphs (split on blank lines, `white-space: pre-wrap`), even though the eventual feature is inline numbered citation markers (GO-21e-f). `AnswerBody` is isolated as its own component precisely so f can swap plain-text rendering for span-aligned markers without touching `Conversation`/`Message`.
**Why it matters:** Slicing by render branch (happy path now, citations next) works only if the seam is drawn where the future change lands. Giving the answer its own component today is what makes the citation work a local edit tomorrow, not a `Conversation` rewrite.

### Reduced-motion falls out of one global rule, so the shimmer skeleton needed no special-casing
**Concept:** `LoadingAnswer` is a CSS shimmer (animated gradient). It respects `prefers-reduced-motion` for free because `tokens.css` has a global `@media (prefers-reduced-motion: reduce)` block that clamps every animation/transition to ~0ms — the shimmer simply freezes into a static skeleton. No per-component motion guard.
**Why it matters:** Putting the reduced-motion clamp once at the token layer means every future animated component inherits the a11y behavior without remembering to add it. Cross-cutting accessibility is cheapest enforced globally, not re-implemented per component.
**Explain it in one line:** "The main pane shows one active exchange (the history drawer is the selector, so no thread), the answer gets its own `AnswerBody` component as the seam for GO-21e-f citation markers, and the loading shimmer inherits reduced-motion from one global token-layer rule."

## Chat UI: the honest states — abstain, capability, error (GO-21e-e)

### Color is the semantics: abstain/no-citation are `--info`, only real failures are `--danger`
**Concept:** Three states that a naive UI lumps as "something's wrong" are deliberately split by token. `AbstainCard` ("not in the corpus") and `CapabilityNote` (provider can't cite) use `--info`/`--info-subtle` — calm, informational, a little proud. `ErrorState` (network/5xx) is the *only* component that touches `--danger`. The discipline is enforced at the token layer, not by copy: abstain literally cannot look like an error because it never references the danger tokens.
**Why it matters:** For a citation-grounded product, "I don't know / I can't verify that" is the feature — the whole point is that it doesn't bluff. Styling honesty as a fault would undersell the differentiator. Reserving one color for genuine failure is what makes trustworthiness read as intentional.

### Retry re-runs the exchange in place — a `retry` action, not a resubmit
**Concept:** `ErrorState`'s retry doesn't call `submit()` (which mints a new id and prepends a fresh history entry — a duplicate). It dispatches a `retry` action that flips the *existing* exchange back to `pending` and re-runs `runQuery(id, question)` against the same id. `submit` and `retry` share the extracted `runQuery`; they differ only in whether they create the exchange or reuse it. Since failures aren't persisted, a successful retry simply turns the in-place entry into a saved result.
**Why it matters:** Identity matters once state is a list. "Try again" should mutate the thing that failed, not spawn a sibling — otherwise the history fills with dead duplicates. Extracting the shared run path kept new-vs-retry a one-line difference instead of two copies of the fetch/dispatch dance.

### CapabilityNote is the render-time payoff of storing `QueryResult`, not a flag
**Concept:** The "answered" phase splits into grounded vs uncited-honest purely at render: `phase === 'answered'` shows `AnswerBody`, and `!result.citationsSupported` additionally shows `CapabilityNote`. No `answeredUncited` phase, no stored boolean — the component reads `citationsSupported` straight off the `QueryResult`. This is exactly the GO-21e-c "derive, don't store" decision cashing out again: a new sub-state cost one conditional, not a reducer change.
**Why it matters:** Every state branch you can compute from the payload is a branch you don't have to keep in sync. The uncited-honest case fell out for free because the raw result was kept whole.
**Explain it in one line:** "Abstain and no-citation are `--info` (honesty is a feature, only real failures get `--danger`), retry mutates the failed exchange in place via a `retry` action sharing `runQuery` (no duplicate history), and the uncited-honest note is derived from `citationsSupported` at render — the 'store the result, branch at the leaf' rule paying off a third time."

## Chat UI: citations + Sources panel — the headline UX (GO-21e-f)

### The contract shape drove a product decision: grouped citations, not inline-at-span
**Concept:** The design guide wanted inline `¹²³` markers aligned to spans in the answer. But the backend flattens Claude's per-text-block citations into one `answer` string + a flat `citations[]`, and each `citedText` is the *source* span (not answer text) — so there's no offset to place a marker, and substring-matching source text into the answer is unreliable. Rather than silently do a backend contract change mid-UI-slice, I surfaced the fork and the user chose **UI-only, grouped citations**: numbered chips beneath the answer, each a Radix popover of the quoted `citedText` + source, clicking one expands the Sources panel and highlights the chunk it points at (`documentIndex → chunks[i]`).
**Why it matters:** What the API actually returns constrains what the UI can faithfully claim. "Inline at the exact span" is a promise the current contract can't back, and faking it (guessed marker positions) would undercut a citation-first product's whole credibility. Grouped-but-accurate beats inline-but-approximate. The honest move was to make the constraint a visible decision, not a quiet backend expansion.

### `documentIndex` is the join key that makes citations and the Sources panel one interaction
**Concept:** Citations and retrieved chunks are two views of the same data joined on `documentIndex`. `AnswerView` computes `citeNumbersByChunk` (which citation numbers point at each chunk) once via `useMemo`, so the Sources panel can mark cited chunks *and* a citation click can scroll/highlight its chunk — one small piece of derived state wiring both directions. The panel shows *every* retrieved chunk (cited or not) with a `ScoreBar`, which is the portfolio signal: you see what was cited **and** what was retrieved-but-not-cited.
**Why it matters:** The trust surface isn't "here are the citations" — it's "here's everything retrieval saw, and here's which of it the answer actually used." Exposing the un-cited chunks with their scores is what turns a chatbot into an auditable retrieval tool. Joining on the index the backend already provides kept that cross-highlight to derived state, no new plumbing.

### Radix Popover buys the a11y that hand-rolled citation tooltips always get wrong
**Concept:** Each citation chip is a real `<button>` wrapped in `@radix-ui/react-popover` — focus management, Esc-to-dismiss, `aria` wiring, portal + collision handling all come for free. The click handler does double duty: Radix opens the popover, and the same `onClick` fires `onActivate(documentIndex)` to drive the Sources highlight. Cost: ~70 KB gzipped added to the bundle.
**Why it matters:** Accessible popovers (focus trap, dismissal, ARIA relationships) are deceptively hard to hand-roll and easy to ship broken. For an interaction that IS the product's differentiator, leaning on a vetted primitive is worth the bundle weight — and layering the app's own side effect onto the trigger's onClick kept the popover and the highlight as one gesture.
**Explain it in one line:** "The flattened contract (source-span `citedText`, no answer offset) made inline markers infeasible, so citations render as grouped Radix-popover chips joined to the Sources panel on `documentIndex` — showing cited *and* un-cited chunks with score bars, the auditable-retrieval signal — rather than faking inline positions."

## Chat UI: serving the built React app from Nest (GO-21e-g)

### Two build stages, one image — the UI is baked in, not a second server
**Concept:** A dedicated `web-build` Docker stage (`npm ci` + `vite build` → `/web/dist`) runs alongside the server build stage; the distroless runtime copies `/web/dist` in and Nest serves it via `useStaticAssets(../web/dist)`, same origin as `/query`. So `docker compose up` still yields a working UI at `/` with zero extra steps and no second web server — the PRD §5 one-command promise, unregressed. The old `web/public/` bind-mount (live-edit the vanilla prototype) was removed: a built artifact isn't live-editable, and keeping the mount would shadow `web/dist` with stale files.
**Why it matters:** Same-origin static serving is what keeps the CORS story at "there isn't one" in prod, mirroring the Vite dev proxy. A separate stage keeps the browser toolchain out of the shipped image (distroless stays minimal) while still producing the assets it needs. When you switch what's served, remove the mount that fed the old thing — a leftover bind-mount silently wins over a COPY.

### `**/dist` in .dockerignore matters once there are two `dist/`s
**Concept:** The root `.dockerignore` said `dist` (matches only the top-level server build output). Adding a second package (`web/`, which builds to `web/dist`) meant that stale local `web/dist` + `web/node_modules` could ride into the build context and get copied over the fresh in-image build. Switching the patterns to `**/dist` and `**/node_modules` excludes both packages' artifacts everywhere, so every image build compiles from source.
**Why it matters:** `.dockerignore` patterns are path-anchored — a bare `dist` isn't recursive. The moment a repo has more than one build output, the ignore rules need `**/` or the context leaks stale artifacts that can override what the Dockerfile deliberately rebuilds.
**Explain it in one line:** "A `web-build` stage compiles the React app and the distroless runtime serves `web/dist` via `useStaticAssets` (same-origin, no second server, one-command run intact); dropping the old `web/public` mount and switching `.dockerignore` to `**/dist`+`**/node_modules` kept stale artifacts from shadowing the fresh build."

## Chat UI: full-polish + a11y pass (GO-21e-h)

### Most of the a11y "pass" was banked earlier — the token layer and Radix did the heavy lifting
**Concept:** GO-21e-h had little net-new work because the cross-cutting a11y was decided at the foundation: reduced-motion is one global `@media` clamp in `tokens.css` (every animated component inherits it), focus rings are one global `:focus-visible` rule in `index.css`, citation popovers got focus/Esc/ARIA from Radix, and the error correlation id was surfaced in `ErrorState` when it was built. The dedicated pass then only had to add the genuinely-missing pieces: an `ErrorBoundary` around the conversation subtree (guide §9) and a *targeted* `aria-live` (moved off the whole scroll region onto the assistant turn, so a completed answer is announced without re-reading the user's own question).
**Why it matters:** Accessibility is cheapest when it's a property of the design system, not a checklist at the end. Deciding motion/focus/contrast at the token layer means the "a11y pass" degenerates to verification plus a couple of structural additions, instead of retrofitting every component.

### "AA verified" means computing the ratios, not eyeballing swatches
**Concept:** I scripted the WCAG contrast ratios for the actual token pairs in both themes and found two real light-theme fails — `--text-muted` on surface (2.56) and `--success` used for the "grounded" label on surface-2 (3.00) — both on *small* text. Fixed by darkening only those tokens (muted → `#6b7280` = 4.83; success → `#15803d` = 4.56–5.02; dark muted → `#8b8b93` = 5.24) and re-computing. The remaining sub-4.5 pairs (dark accent-on-surface 3.97, white-on-accent 4.47) are icons / tiny supplementary markers that clear the 3.0 UI-component / large-text bar, so they're documented exceptions, not silent fails.
**Why it matters:** A palette that "looks fine" routinely ships small-text contrast failures — the guide's own muted grey failed at 2.56. The only honest way to claim AA is to compute foreground/background ratios for the pairs as actually used and fix the ones that miss; and to be explicit about which sub-threshold pairs are legitimately exempt (icons, large text) rather than rounding them up.
**Explain it in one line:** "The a11y pass was mostly verification because motion/focus/contrast were decided at the token layer up front; the real work was an `ErrorBoundary` + a targeted `aria-live`, plus fixing two computed AA contrast fails (muted + success on light) rather than trusting the swatches."

## GO-21j · Embeddable surface (RAG-66b)

### An embeddable module *re-exports* the pipeline — it composes, it never re-implements
**Concept:** `RagModule.forRoot()` is a `DynamicModule` whose `imports` are the *same* feature modules the standalone app wires (`Database`/`Embedding`/`VectorStore`/`Ingestion`/`Retrieval`/`Generation`), and whose `exports` re-export those modules so a host can inject `IngestionService`/`RetrievalService`/`GenerationService`. Not a line of pipeline logic is copied — the third entrypoint (embedded library, alongside HTTP and CLI) runs the identical graph. The only real wiring change this forced: a Nest module only makes a provider injectable *outside* itself if it `exports` it, and two modules (`Ingestion`, `Generation`) previously exported nothing (their services were consumed only in-module or via a controller). Re-exporting a module surfaces exactly what that module exports — so those two needed an `exports: [XService]` before `RagModule` could pass them through.
**Why it matters:** "One pipeline, three entrypoints" is only true if the entrypoints share the wiring, not just the intent. The moment an embed path re-declares providers, it forks — and the fork drifts. Composing modules (and fixing the missing `exports` at the source module, not papering over it in `RagModule`) keeps a single wiring authority. It also means the whole importable surface is ~40 lines: the value is in the seams that were already there.

### `private:true` + `declaration:false` is the real "not a library" — `main`/`types`/`exports`/`files` is the surface
**Concept:** The repo built and ran fine for milestones while being fundamentally un-importable: `private:true` blocks publish/pack semantics, no `main`/`types` means a host has no entry or types, and `declaration:false` means `tsc` emits **no `.d.ts`** so even a `main`-pointed consumer gets `any`. Making it embeddable was four `package.json` fields (`private:false`, `main`→`dist/index.js`, `types`→`dist/index.d.ts`, an `exports` map), a `files:["dist"]` whitelist, and flipping `declaration:true`. The `files` whitelist doubles as the **secrets guard** — `npm pack --dry-run` confirmed the tarball is `dist` + manifest only (169 files, no `.env`, no `eval/sample-corpus`, no `db/`), which is the rule `ai-and-secrets.md` guarantee made mechanical rather than trusted.
**Why it matters:** "It compiles and runs" and "a host can import it with types" are different claims — the gap is entirely in the manifest + `declaration`, not the code. And the cheapest, most reliable secrets guard for a package isn't a `.npmignore` blocklist (easy to under-specify) but a `files` allowlist verified with `npm pack --dry-run`: default-deny beats default-allow when the cost of a miss is a leaked key.
**Explain it in one line:** "Embeddable = compose the same feature modules behind `RagModule.forRoot()` and re-export the services (fixing the missing `exports` at the source module, never re-implementing), plus four `package.json` fields + `declaration:true` + a `files:['dist']` allowlist that `npm pack --dry-run` proves ships no secrets."

## GO-21j · Typed `forRoot(options)` override surface (RAG-66c)

### Nest concatenates a class's static `@Module()` metadata with a `DynamicModule`'s own `imports`/`controllers` — it never replaces them
**Concept:** Adding a `k`/`minScore` override meant `GenerationModule.register({ retrieval })` importing its own `RetrievalModule.register(options.retrieval)` — but `GenerationService` kept resolving to a *different*, unconfigured `RetrievalService` (env defaults, override silently dropped). Traced it into `@nestjs/core/scanner.js`: `reflectImports(module, token)` builds each module-instance's import list as `[...reflectMetadata(IMPORTS, class), ...dynamicMetadataForThisToken(IMPORTS)]` — the class's own `@Module({ imports: [...] })` decorator content and the `DynamicModule` object's own `imports` are **concatenated**, not one replacing the other, and this happens for *every* module-instance-token of that class, including ones built via a static method. Since `GenerationModule`'s decorator still said `imports: [RetrievalModule]` (bare, no override), calling `.register()` produced an import list of `[RetrievalModule (bare, static-tokened), RetrievalModule.register(...) (dynamic-tokened)]` — two genuinely separate module instances (bare-class references use a *static* token cache; `DynamicModule` objects hash a token from their own serialized metadata — never equal to each other), and DI silently wired to the wrong one. `providers` don't have this failure mode: Nest's provider map is keyed by token, so a second `{provide: X, ...}` for the same token just overwrites the first (`Map.set`, last wins) — confirmed via `injector/module.js`'s `addProvider`/`addCustomProvider`. That's why the `embeddingProvider`/`generationProvider` overrides (provider-level swaps within one module) worked from the first attempt while the retrieval `k`/`minScore` override (module-level swap, via `imports`) silently no-opped. `controllers` has the identical concatenation failure mode as `imports` — a decorator-level `controllers: [GenerationController]` always won regardless of `register()`'s `http` flag (empirically: the "no HTTP by default" test got a 500, not a 404 — the route *was* registered, and only failed because the test's mock provider had no return value).
**Why it matters:** "The dynamic module's own config should override the decorator's" is a reasonable mental model — and wrong for `imports`/`controllers` specifically, even though it's *right* for `providers` in the same file. A partially-correct mental model is more dangerous than a totally wrong one, because it passes some tests (the provider-token overrides) and silently fails others (the module-level override) with no error — just a wrong default value, indistinguishable from "the override wasn't wired" without an assertion on the *actual runtime effect* (`store.search`'s second arg), not just "does `.get()` return an instance." The fix: any class that needs a `register()`-style conditional/override surface must keep `imports` and `controllers` **out of the decorator entirely** and build them only inside `register()` — which forces *every* consumer, including the standalone app's own `AppModule`, through the same method. That's not a workaround; it's the correct shape — one wiring authority, matching the "adapters are the swap points" rule instead of fighting it.
**Explain it in one line:** "`@Module()` decorator metadata and a `DynamicModule`'s own metadata get concatenated, not replaced — safe for `providers` (token-keyed, last wins) but silently broken for `imports`/`controllers` (plain arrays, no dedup), so any module needing a `register()` override must keep those two keys out of the decorator and route every consumer — including the standalone app — through `register()`."

## GO-21j · The `rag init` scaffold generator (RAG-66d)

### An earlier design decision (RAG-46's `MIGRATIONS_DIR` override) quietly solved this slice's hardest problem
**Concept:** `rag init`'s DB story needed the host to *apply* the generated `db/rag/001_init.sql` somehow. Before writing anything new, I checked `src/database/migrate.ts` (RAG-46) and found `migrationsDir()` already reads `process.env.MIGRATIONS_DIR ?? <default>` — meaning a host can run `MIGRATIONS_DIR=db/rag DATABASE_URL=... node node_modules/rag-knowledge-store/dist/database/migrate.js` **today, with zero new code**, and get the exact same transactional, ledger-tracked apply this repo uses for itself. That command is now documented directly in the generated SQL file's header comment, so it ships as part of the scaffold rather than living only in a subtask note.
**Why it matters:** RAG-46's runner wasn't designed with "a host embedding us" in mind — it was built to replace the initdb-only bootstrap for this repo's own deploy story. The env-var override was added for flexibility, not for this. Checking what already exists before building a "DB path" for RAG-66e is what turned a subtask into a documentation line: the cheapest slice is the one you don't have to build, and you only find it by reading the code that's already there instead of assuming a gap.

### `--dry-run` must walk the same skip/force decision tree as the real write — not a separate "preview" branch
**Concept:** `runInit()` has one loop over `scaffoldFiles()`: for each file, check existence first (`skipped` if it exists and `!force`), and *only then* branch on `dryRun` (`would-write` vs. actually writing). A tempting alternative — a separate `if (dryRun) { print preview; return }` short-circuit at the top — would silently drift from the real path's logic (e.g. forgetting the exists-check in the preview branch would make `--dry-run` claim it'll overwrite a file that `--force`-less real run would actually skip). Keeping one decision tree with `dryRun` as the *last* fork means the preview is provably what the real run would do, and a dedicated test (`--dry-run over an existing file reports skipped, not would-write`) asserts that ordering directly rather than trusting it by inspection.
**Why it matters:** A `--dry-run` flag is only trustworthy if it's structurally *incapable* of lying — i.e., it shares the decision code, not just the intent, with the real path. Two branches that are supposed to agree are a standing invitation for exactly one of them to get a fix and not the other.
**Explain it in one line:** "`rag init` writes idempotently (skip-existing, `--force` to overwrite) with `--dry-run` sharing the exact same skip-check before it forks on dry-run vs. write — so the preview can't drift from the real path — and the DB-apply story RAG-66e was going to need already existed, for free, in RAG-46's `MIGRATIONS_DIR` override."

## GO-21j · Verifying the DB path live, and a real `npm run` footgun (RAG-66e/f)

### "Documented" isn't "verified" — the migration-runner reuse needed a real disposable Postgres, not a read-through
**Concept:** RAG-66d already *documented* that a host could apply `db/rag/001_init.sql` with the shipped `migrate.ts` via `MIGRATIONS_DIR`. RAG-66e's job was to stop trusting that and prove it: scaffold into a throwaway dir, `docker compose -f docker-compose.rag.yml up -d` (the **generated** file, run for real, not read), apply the schema with the exact documented command, re-run it to confirm the ledger makes it a no-op, then `rag ingest eval/sample-corpus` with `EMBEDDING_PROVIDER=transformers` (key-free — ingestion needs no LLM, so this needed no API keys) and cross-check the row count with a direct `psql` query inside the container, independent of what the CLI claimed. Torn down (`docker compose down -v`) after.
**Why it matters:** A migration file and a runner flag being individually correct doesn't guarantee the combination works — dims mismatches, path resolution, or a stale assumption about the runner's cwd could all break silently. The generated SQL was consumed by the *real* `IngestionService`/`PgVectorStore`, the same code path a real host would exercise — that's what makes this a verification of RAG-66e's actual done-when ("applies the schema... and ingest works"), not a restatement of RAG-66d's documentation.

### `npm run <script> <flags>` silently eats recognized-looking flags unless you pass `--` — and it fails by *doing the wrong thing*, not erroring
**Concept:** Testing `npm run rag init --target /tmp/x --dry-run` (no `--`) produced no error — it printed a *plausible* success message and exited 0. What actually happened: npm interpreted `--target` and `--dry-run` as flags to `npm` itself (not the script), silently dropped them, and ran `node dist/cli/main.js init` with **no arguments** — which defaulted `--target` to `process.cwd()` (this repo's own root, since that's where `npm run` was invoked from) and dry-run **off**. It wrote four real scaffold files into this repo's working tree, twice, before I checked `git status` and caught it. `npx rag init --target /tmp/x --dry-run` has no such problem — npx passes everything after the command straight through.
**Why it matters:** This is the dangerous shape of bug: no error, a real (wrong) target, a plausible-looking success message — the only tell was `git status` showing untracked files where none should be. I only caught it because I happened to check after an unrelated step, not because anything signaled failure. Documented both invocations precisely in the README (`npx rag init [flags]` works directly; `npm run rag -- init [flags]` needs the `--`) rather than picking one — a tool with two entrypoints and only one of them safe-by-default is worth calling out explicitly, not silently preferring.
**Explain it in one line:** "RAG-66e replaced a documented claim with a live one — real `docker compose up` on the generated file, the shipped runner, `rag ingest` cross-checked against a direct `psql` count — and RAG-66f's `npm run rag` script surfaced a real footgun: without `--`, `npm run` drops flags silently and succeeds anyway with the wrong defaults, so I documented `npx rag init [flags]` as the safe form and `npm run rag -- init [flags]` (note the `--`) as the alternative."

## Chat UI: a ticking loader for the honest cost of local inference

### A static skeleton is only truthful for sub-second waits — past ~10s it reads as frozen
**Concept:** Container logs showed real `/query` latencies of 4-25s against the bundled local qwen2.5:3b (CPU inference) — not a bug, just the honest cost of the key-free path. But `LoadingAnswer` rendered the same three shimmer bars for the entire wait with zero variation, so a 25-second answer looked indistinguishable from a hung request. Fixed by adding an internal `setInterval` tick (`useState` + `useEffect`, own timer, no lift to the reducer) that renders an elapsed-seconds counter and a status line that changes at fixed thresholds (`Retrieving…` → `Generating…` → `Still generating — local models can take up to 30s…` past 8s).
**Why it matters:** A loading state's job is to prove liveness, not just presence. An animation that loops identically for 25 seconds proves nothing changed — a number that increments every second is unambiguous, cheap evidence the request is still in flight. The threshold message is also honest framing: it tells the viewer *why* it's slow (self-hosted, CPU) rather than leaving them to wonder if something's broken.

### Keep the ticking part out of the `aria-live` announcement, or it spams every second
**Concept:** `LoadingAnswer` sits inside the assistant `Message`'s `aria-live="polite"` region (added in GO-21e-h). The natural instinct — put the live status text in the outer `aria-label` — would mean the label itself changes every second, and `aria-live` re-announces on every attribute mutation inside its region: a screen reader user would hear "4 seconds… 5 seconds… 6 seconds…" for the whole wait. Fixed by keeping the outer container's `aria-label` static ("Retrieving and generating the answer" — announced once) and marking the ticking skeleton + status text `aria-hidden="true"`, since elements removed from the accessibility tree don't trigger `aria-live` mutations.
**Why it matters:** `aria-live` doesn't know the difference between "meaningful update" and "cosmetic tick" — it reacts to any DOM mutation inside its region. Anything that changes purely for sighted users (a timer, a shimmer) needs to be explicitly `aria-hidden` inside a live region, or accessibility and liveliness end up fighting each other.
**Explain it in one line:** "Real local-model latency (4-25s) made the static shimmer skeleton look frozen, so `LoadingAnswer` grew its own ticking elapsed-seconds status; keeping that tick `aria-hidden` (with a static outer `aria-label`) stopped the parent's `aria-live` region from re-announcing every second."

## A citation-verifying wrapper: earning `supportsCitations: true` without a native API (RAG-68)

### Verification and fabrication are opposite operations, even though both "add citations" to an uncited answer
**Concept:** The rule (`ai-and-secrets.md`) bans prompt-engineering a citation format as a substitute for native support — asking a model to emit `[1]`/`[2]` markers and trusting them is exactly the brittleness D4 rejected. `CitationVerifyingGenerationProvider` also adds citations to an answer that had none, but the operation is inverted: it never asks the model anything about citations, and never trusts a claim the model makes. It takes the model's plain answer as a fixed input, then — entirely in my own deterministic code — checks each sentence against the *actual* retrieved chunk text via longest-common-word-run matching, crediting a citation only when a real, computable overlap clears a conservative bar. `citedText` is sliced verbatim from the chunk, not the model's output, so every citation is independently checkable against source text, not model-asserted. That's what makes `supportsCitations: true` an honest claim instead of the same brittleness on a smaller model.
**Why it matters:** The rule isn't "never associate an answer with a source" — it's "never claim verifiability you don't have." A wrapper that does its own checking against ground truth is the opposite of the thing being banned, even though the visible feature ("this answer now has citations") looks identical from the outside. What matters is which side of the answer the trust is coming from — the model's self-report, or an independent check against the data.

### Conservative thresholds trade recall for precision on purpose — a missed citation is safe, a wrong one isn't
**Concept:** The match bar (≥6 words AND ≥60% of the sentence's words as one contiguous run) is deliberately strict. A looser bar would catch more true citations but also credit coincidental overlaps (a stray shared phrase from an unrelated chunk) as if they were real support. Since an uncited sentence just renders as an ordinary sentence — not an error, not a broken feature — a false negative costs nothing but completeness. A false positive costs trust: a citation chip that points at the wrong chunk *actively lies* about where an answer came from, which is worse than the local model's honest baseline of zero citations.
**Why it matters:** This mirrors the project's abstain-over-wrong-answer stance (D5) at the citation level: given a choice between "confidently correct sometimes" and "silent sometimes but never wrong," pick silent. A verification layer should be tuned to fail toward omission, never toward false confidence.

### Positioned tokens, not plain word arrays — matching needs equality, quoting needs the original bytes
**Concept:** Lowercasing and stripping punctuation is necessary for robust word-level matching (so "chunk." and "Chunk" count as the same token), but the citation shown to the user must be an exact, verbatim quote from the source chunk — original casing, punctuation, everything. The tokenizer keeps both: a lowercased `word` for equality comparison, and the token's original `start`/`end` character offsets. Once the longest common run is found, the citation is sliced from the *original* chunk string using those offsets, never reconstructed from the lowercased tokens.
**Why it matters:** Normalizing for matching and normalizing for display are different jobs; collapsing them into one representation would either break matching (case/punctuation-sensitive misses) or produce a citation that isn't actually a real quote (lowercased, depunctuated text presented as a "citedText" is not a verifiable source span anymore). Carrying position metadata through the normalization step is what lets both jobs use the same tokenization pass.
**Explain it in one line:** "The wrapper never asks the model about citations or trusts its claims — it independently checks each answer sentence against the actual chunk text via longest-common-word-run matching, tuned conservatively (an uncited sentence is safe; a mis-credited one isn't), quoting the exact chunk substring via positioned tokens so the normalization used for matching never leaks into what's shown as the citation."

### Live-tested against the bundled qwen2.5:3b: contiguous-run matching under-cites a fluent paraphraser
**Concept:** Unit tests (synthetic near-verbatim answers) all passed, but a live smoke test against the actual local stack (`GENERATION_PROVIDER=citation-verifying`, wrapping the bundled Ollama qwen2.5:3b) told a different story: **0 verified citations across 4 real questions**, even ones clearly grounded in a retrieved chunk. One case made the gap concrete — asked what embedding model the project uses by default, the model correctly answered `VoyageEmbeddingProvider` (the identifier matched the chunk exactly), but wrapped it in its own sentence ("The project uses the Voyage model as the default embedding model by implementing it through an EmbeddingProvider interface with VoyageEmbeddingProvider") — sharing only that one 1-word run with the source's terse `` Default impl: `VoyageEmbeddingProvider` (`voyage-3`). ``, well under the 6-word contiguous-run floor. The model was answering faithfully; the matcher just requires more shared, in-order text than a small instruct model naturally reproduces.
**Why it matters:** A synthetic unit test (I write both the "model output" and the chunk to be near-identical) can't surface this — it only shows up against a real model's real phrasing. "Passes its unit tests" and "does something useful against the actual target model" are different claims, and the gap here is structural: contiguous-run matching is precision-first by design (never mis-credit), which necessarily means it misses citations whenever the model paraphrases fluently rather than lifting phrases — and a well-behaved instruct model paraphrases by default, verbatim reuse is the exception. This is a disclosed, real trade-off (low yield, zero false positives) rather than a defect, and it's the kind of finding that only a live pass — not a green test suite — will show.

## The MCP server is a transport, not a pipeline — and stdout is sacred (RAG-65a)

### A "third entrypoint" is real only if it reuses the app context, not re-implements it
**Concept:** The MCP entrypoint (`src/mcp/main.ts`) is deliberately a near-copy of the CLI bootstrap: `NestFactory.createApplicationContext(AppModule, { logger: false })`, resolve the existing `GenerationService`, hand it to the transport. No chunking, retrieval, abstain, or citation logic lives in the MCP layer — the same way the CLI is a thin `commander` shell. The proof it worked wasn't "it compiled" but that the *identical failure mode* showed up: the empty MCP server and the CLI both exited 1 the instant `VOYAGE_API_KEY` was missing, because both instantiate the same DI graph (the default `VoyageEmbeddingProvider` throws eagerly in its constructor). Sharing the failure is the evidence of sharing the pipeline.
**Why it matters:** The strongest signal the project sells is "clean seams, owned code, no framework lock-in" — a second/third entrypoint that duplicated pipeline logic would quietly refute that. When adding an entrypoint, the tell that you've reused rather than reimplemented is that its bugs and boot requirements are *the same bugs*, not new ones.

### Under stdio, logging to stdout is a correctness bug, not a style choice
**Concept:** MCP stdio uses stdin/stdout as a JSON-RPC channel. Any stray `console.log` / default Nest logger write to stdout interleaves with protocol frames and corrupts the stream — the client sees malformed JSON-RPC. The fix already existed: RAG-63g's `CorrelatedLogger('stderr')`, attached via `app.useLogger(...)` exactly as the CLI does. The smoke test asserts it directly: `initialize` returns `serverInfo` on **stdout**, the readiness line appears on **stderr**, and stdout carries *nothing but* the protocol frame. This is why `bootstrap().catch` writes diagnostics to `process.stderr` too — a fatal must never leak onto the protocol channel even before the logger is wired.
**Why it matters:** D3 in the design guide flagged this as "a hard correctness requirement, not a preference," and the reuse point (an existing stderr logger) is what made honoring it a one-liner instead of a new subsystem. Observability work done for one entrypoint (the CLI) paid off directly for the next.

### Confirm the SDK surface against the installed version — and let the build be the test
**Concept:** The guide repeatedly warned that `@modelcontextprotocol/sdk`'s API drifts, so I read the *installed* 1.30.0 type defs before coding: `registerTool` (not the deprecated `.tool()`), `new McpServer({name,version})`, `connect(transport)`, `StdioServerTransport`, Zod-shaped schemas. The subtler risk was module resolution — the SDK is ESM-first with a wildcard `exports` map (`require -> ./dist/cjs/*`), and this project is CommonJS with classic `node` resolution. Rather than theorize about whether `.js` subpath specifiers would type-resolve, I wrote the imports and ran `tsc --noEmit` + `nest build` — both clean, because the dual CJS build + the `require`/`types` conditions resolve fine under node10. The empirical build was faster and more trustworthy than reasoning about `moduleResolution`.
**Why it matters:** For a fast-moving protocol SDK, "confirm at build time" beats "code from memory" — the API and the resolution behavior are both things the installed package answers definitively. When the concern is module resolution, the typecheck *is* the experiment; run it before inventing config changes you might not need.

## `rag_query` over MCP: return both shapes, and don't invent citation positions (RAG-65b)

### A programmatic caller needs structured flags, not prose it has to parse
**Concept:** The MCP tool returns *both* a text rendering (for clients that only show text) and `structuredContent` — the full `QueryResult` including `grounded` and `abstained`. The reason is the abstain contract: an agent must be able to branch on "did this come from the corpus?" without string-matching the answer against "I don't have that information in the corpus." The text form is for humans; the structured form is the machine contract, and declaring a Zod `outputSchema` mirroring `QueryResult` makes the SDK both validate our serialization on every call and advertise the shape in `tools/list`. Skipping the structured form would force agents into brittle text-matching for the single most important branch in the product.
**Why it matters:** For a retrieval *tool* (as opposed to a chat UI), the grounded/abstained distinction is the whole value proposition — surfacing it as typed data, not embedded in prose, is what lets a downstream agent act on "not in the corpus" correctly instead of treating an honest abstain as an answer or an error.

### The guide said "inline [n] markers" — the data can't honestly support them
**Concept:** The design guide's §4 sketched a text rendering with inline `[n]` markers in the answer prose plus a trailing source list. Building it surfaced that our `Citation` (`citedText`, `source`, `documentIndex`) points into the **source document**, not the answer — Claude's native citations carry a `char_location` into the cited *document*, and the provider normalizes away any answer offset. There is no faithful position to inject `[n]` mid-sentence, so I render a trailing numbered `Sources:` list only and left a comment explaining why. Inventing marker positions (e.g., guessing which sentence a citation supports) would fabricate provenance — the exact dishonesty the citation rules exist to prevent.
**Why it matters:** A design doc written before the code can specify a rendering the actual data model can't back. When that happens the honest move is to render less (a source list) rather than synthesize the missing information to match the doc — and to record the deviation so the guide and the code agree. "Match the spec" loses to "don't fabricate provenance."

### citationsSupported:false on the local model is a passing result, not a failing one
**Concept:** The live stdio-client smoke ran against the key-free stack (bge embeddings + qwen2.5:3b via the OpenAI-compatible provider). The grounded answer came back `grounded:true` with a retrieved chunk and a real model answer, but `citations:[]` / `citationsSupported:false` — because that provider has no native citations. The test asserts this as correct, not as a shortfall: grounding and the abstain guarantee survive the MCP boundary regardless of provider, while native span-level citations are Claude-only (they'd need the cloud profile + keys). Asserting "0 citations here is right" keeps the capability flag honest instead of treating the local model's limitation as a bug to paper over.
**Why it matters:** The citation-serialization correctness for the *Anthropic* path (real `citations[]` mapped to sources) needs a provider that supports citations, so it belongs in a mock-provider unit test (RAG-65c), not a keyless live run. Splitting "does the transport carry grounding + abstain" (live, provider-agnostic) from "does it map real citations" (unit, provider-specific) keeps each check runnable in the environment it actually needs — and avoids pretending a keyless smoke proved something it can't.

## Testing a transport boundary: assert faithful pass-through, not re-derivation (RAG-65c)

### The MCP layer's citation test is about serialization, not citation-making
**Concept:** RAG-65c reads like "test citations," but the MCP layer never makes a citation — it serializes a `QueryResult` the provider already produced. So the unit test captures the registered tool handler (via a stub `McpServer` whose `registerTool` records the callback) and drives it with a stub `GenerationService` returning canned results for each provider shape. It asserts the *boundary contract*: an Anthropic-style result (citations populated, `citationsSupported:true`) arrives in `structuredContent` with its `citations[]` intact and a numbered `Sources:` text rendering; an openai-compatible-style result (`citationsSupported:false`, `citations:[]`) comes through with no citations, no `[n]` markers, and an honest capability note. The actual Claude-native → `Citation` mapping is tested where it lives, in `anthropic-generation.provider.spec.ts`.
**Why it matters:** Testing a pass-through layer by re-testing the logic of the layer beneath it (standing up a real provider, mocking the Claude API) would be slow, duplicative, and would blur which layer owns which guarantee. Capturing the handler and feeding it fixtures tests exactly what this layer is responsible for — faithful serialization — and nothing it isn't.

### "Never fabricates a citation" is a property you assert with a negative
**Concept:** The done-when — "a non-citation provider never fabricates a citation through MCP" — is a *negative* property, and the test encodes it as negative assertions against the openai-compatible fixture: `citations` is `[]` in `structuredContent`, the text matches no `/\[\d+\]/` marker, and there's no `Sources:` section — while `grounded` stays `true` (the answer is still from the corpus, just uncited). Pinning down "it didn't invent anything" takes explicit absence checks; a test that only asserted the happy Anthropic path would pass even if the local path silently grew fake markers.
**Why it matters:** Safety-shaped requirements ("never X") are satisfied by proving X is absent under the conditions that would tempt it, not by proving the feature works when it's supposed to. For a grounding product, the negative assertions (no fabricated citations, abstain not masked) are the ones that actually protect the promise.

## Gating a write capability: keep the switch out of the tool, and default to off (RAG-65d)

### The gate belongs above the tool, as a pure function, not inside it
**Concept:** `rag_ingest` is a plain tool definition (`registerIngestTool`) that knows nothing about whether it should exist; the `MCP_ENABLE_INGEST` decision lives one level up in `registerTools(server, {generation, ingestion, enableIngest})`. That split means the tool file has no config dependency, and the gate — the security-relevant `if` — is a pure function testable without booting Nest: pass `enableIngest:false` and assert `tools/list` is `['rag_query']`; pass `true` and assert `rag_ingest` joins it. If the flag check lived inside the tool (e.g., registering always but throwing when disabled), the tool would still appear in `tools/list`, advertising a capability that then errors — worse than not offering it, and much harder to unit-test in isolation.
**Why it matters:** For a capability grant, "not registered" is a stronger guarantee than "registered but refuses" — an absent tool can't be discovered, described, or attempted by an agent. Putting the gate in a small pure aggregator makes that guarantee both correct and cheap to test, and keeps each tool file about *what the tool does*, not *whether it's allowed*.

### Default-off is the safe default for anything that writes through an agent
**Concept:** `MCP_ENABLE_INGEST` defaults to `false`, read as `config.get<string>('MCP_ENABLE_INGEST', 'false') === 'true'` — the same string-compare idiom as `METRICS_ENABLED`, but inverted so the *absence* of the var yields the *closed* state. `rag_query` (read-only) ships on; `rag_ingest` (filesystem-read + corpus-write) is opt-in. The reasoning is threat-model, not preference: an MCP server can be connected to an arbitrary agent, and a write tool lets that agent mutate the corpus and read files by path. Query-only-by-default means the risky surface only exists when an operator deliberately enabled it.
**Why it matters:** The failure modes of the two defaults aren't symmetric. Default-on-and-forget silently exposes writes to every agent that connects; default-off-and-forget just means someone has to set a flag to get a feature. When one direction's mistake is a security exposure and the other's is a minor inconvenience, the default goes to the safe side — and the live check should assert the *absence* under the default, not just the presence when enabled.

## A second transport, not a second server: same tools, different bytes (RAG-65e)

### The transport is a plug; the tool set stays identical
**Concept:** Adding Streamable HTTP didn't touch a single tool. `registerTools(server, deps)` is called the same way whether the server connects a `StdioServerTransport` or a per-request `StreamableHTTPServerTransport` — the transport only changes how JSON-RPC frames move. `main.ts` branches once on `MCP_TRANSPORT` and either connects stdio or hands the same `deps` to `startHttpServer`. The live proof is that the exact same `rag_query` grounded/abstain behavior showed up over HTTP as over stdio, with no tool code in the diff. If the two transports had needed different tool wiring, that would have been a sign the tools were coupled to the transport — they aren't, which is the whole point of the MCP server-vs-transport split.
**Why it matters:** "Support another transport" should be a small, localized change if the layering is right. When it isn't — when a new transport drags in changes to the tools or the pipeline — that's the signal a boundary leaked. Keeping the tool set transport-agnostic is what let stdio (local agents) and HTTP (remote/connector) coexist behind one entrypoint.

### Auth config fails closed: http without a token throws at startup, not at first request
**Concept:** `resolveMcpServerConfig` rejects `MCP_TRANSPORT=http` with no `MCP_AUTH_TOKEN` by throwing during bootstrap — the server never binds a port. The alternative (start, then 401 everything, or worse, serve open) was rejected: an HTTP MCP endpoint with no auth is a corpus exposed to anyone who can reach the port, and "I forgot to set the token" should be a loud startup failure, not a silently-open server. The bearer check itself (`isAuthorized`) uses `timingSafeEqual` over equal-length buffers so a wrong token can't be recovered by timing, and it's a pure function unit-tested for the missing-header / wrong-scheme / length-mismatch / exact-match cases separately from the live 401.
**Why it matters:** For anything that gates network access to data, the safe failure is refuse-to-start, not start-and-hope. Making the misconfiguration fatal at boot turns a possible security hole into an obvious, immediate error — and testing the auth predicate as a pure function means the security-critical logic is verified deterministically, with the live curl (401 on no/wrong token, 200 on correct) confirming it's actually wired into the request path.

### Stateless per-request is the low-surface default for a stateless tool server
**Concept:** The HTTP transport uses `sessionIdGenerator: undefined` and builds a fresh `McpServer` + transport for each request, rather than maintaining sessions and an in-memory connection store. RAG has no per-client state — each `rag_query`/`rag_ingest` is self-contained — so sessions would add a store to manage (and leak/expire) for no behavioral gain, and the SDK explicitly warns that reusing one server across concurrent stateless requests risks request-id collisions. The pipeline services (`generation`/`ingestion`) are still resolved once and shared; only the thin MCP protocol objects are per-request.
**Why it matters:** Session state is a liability you take on only when the protocol needs it. Matching the transport's statefulness to the application's actual state (none, here) keeps the concurrency model trivial and the failure surface small — the expensive things (DB pool, embedding model) are shared, the cheap things (a protocol wrapper) are disposable.
