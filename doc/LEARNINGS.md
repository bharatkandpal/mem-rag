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
