# RAG-63 — Observability framework

> Parent: metrics + `GET /metrics`, request tracing via correlation IDs across
> ingest/retrieve/generate, and error surfacing — built on the RAG-42 structured-logging
> baseline. Source: `TDD` §3, `PRD` §6 (NFR), `tasks.md` RAG-63.
> **Stack decided 2026-07-23 — thin/in-process:** `prom-client` `/metrics` + `AsyncLocalStorage`
> correlation IDs + a global exception filter (no OTLP collector). Approach note to follow:
> [`docs/observability-guide.md`](../docs/observability-guide.md).

> 🔓 **This is the gate.** RAG-63 is itself the hard gate before the chat UI (GO-21e) — so it is
> **not** blocked by anything; landing it **unblocks GO-21e-b onward**. Slicing (RAG-63a) is
> planning; RAG-63b onward is code (codemap + LEARNINGS apply; **not** retrieval-affecting, so no
> eval run — `[eval-ok]`, per rule `evals.md`).

| ID | Sub-task | Done when | Depends on |
|----|----------|-----------|------------|
| RAG-63a | **Write the observability approach note** — stack, metric set, correlation-ID rule, error contract | `docs/observability-guide.md` committed and reviewed | — *(done 2026-07-23)* |
| RAG-63b | **Add correlation-id context + HTTP middleware** — `AsyncLocalStorage` store; honor inbound `x-request-id` else `randomUUID()`; echo it on the response header | Every HTTP request runs inside an ALS scope with an id; response carries `x-request-id` | RAG-63a |
| RAG-63c | **Thread the id into structured logs** — thin custom Nest logger / wrapper that prefixes each line from ALS, so the RAG-42 counts+latency logs become correlated | All logs across ingest/retrieve/generate for one request share the id, no call-site edits | RAG-63b |
| RAG-63d | **Add `prom-client` registry + `GET /metrics`** — mirror `/healthz`; `collectDefaultMetrics()` + an HTTP request counter/histogram via an interceptor; `METRICS_ENABLED` env | `curl /metrics` returns Prometheus text incl. `rag_http_request_duration_seconds` | RAG-63a |
| RAG-63e | **Instrument domain metrics** — ingest (docs/chunks), retrieval score histogram, `rag_query_total{outcome}` (`grounded`\|`abstained`), generation duration by provider | `/metrics` exposes the §4 series and they move under load; abstain counts as `abstained`, not an error | RAG-63d |
| RAG-63f | **Global exception filter → error surfacing** — log w/ id + stack, bump `rag_errors_total{type}`, return `{statusCode,message,correlationId}`; **abstain (200) and validation (4xx) never counted as errors** | A forced 500 returns the structured body w/ id and bumps the counter; abstain + 4xx unaffected | RAG-63b, RAG-63e |
| RAG-63g | **Extend correlation to the CLI** — wrap `src/cli/main.ts` command bodies in an ALS scope with a generated id | `rag ingest` / `rag query` logs share one id per invocation | RAG-63c |
| RAG-63h | **Wire compose + verify + docs** — `/metrics` reachable under `docker compose up`; unit tests (filter, correlation, registry); live smoke (request → correlated logs + `/metrics` + structured error); update `doc/codemap.md` + `doc/LEARNINGS.md`; commit `[eval-ok]` | Smoke passes; tests green; codemap + LEARNINGS updated; **GO-21e gate lifted** | RAG-63e, RAG-63f, RAG-63g |

**Open decisions:** none blocking. Stack is decided (thin/in-process). The OpenTelemetry
traces/OTLP path is intentionally deferred — kept as an additive seam (guide §6), not built now.

**Start here:** RAG-63a is done (the approach note). The next actionable move is **RAG-63b**
(correlation-id ALS + HTTP middleware) — and unlike the UI, **nothing gates it**; RAG-63 is the
gate, so this track can start immediately. RAG-63b and RAG-63d are independent (context vs.
metrics) and can go in parallel.
