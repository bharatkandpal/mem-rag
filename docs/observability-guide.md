# Observability Approach — RAG (RAG-63)

> The **approach note to follow** when building the observability framework. It fixes the
> stack, the metric set, the correlation-ID rule, and the error-surfacing contract *before*
> code, so the build (sliced in [`subtasks/RAG-63.md`](../subtasks/RAG-63.md)) executes a
> decided design. Companion to the UI's [`ui-design-guide.md`](ui-design-guide.md).
>
> **Stack decided 2026-07-23 — thin / in-process:** `prom-client` at `GET /metrics` +
> `AsyncLocalStorage` correlation IDs threaded into the existing Nest `Logger` + a global
> exception filter. No OTLP collector, no extra compose service. Matches the repo's thin/owned
> ethos (no heavy framework — same spirit as "no LangChain"). An OTel span seam is left open
> for a future distributed-tracing upgrade, but not built now.
>
> **Why this gates the UI (GO-21e):** a user-facing surface without request tracing / metrics /
> error surfacing isn't shippable here (`tasks.md:62`). The correlation ID this produces is
> exactly what the UI's `ErrorState` surfaces (GO-21e-h).

---

## 0. What already exists (the RAG-42 baseline — build on it, don't rewrite)

Every path already emits **counts + latency** through a per-class Nest `Logger`:

| Path | Existing log (RAG-42) |
|---|---|
| ingest | `ingested N docs, M chunks in Xms` (`ingestion.service.ts:67`) |
| upsert | `upserted N chunks in Xms` (`pgvector.store.ts:44`) |
| search | `search returned N hits (k=…) in Xms` (`pgvector.store.ts:59`) |
| retrieve | retrieval summary (`retrieval.service.ts:45`) |
| generate | generation summary (`anthropic-…:60`, `generation.service.ts:51`) |
| embed | embed batch summary (`voyage-…:54`) |

There is **no** global interceptor, exception filter, or correlation middleware yet
(`app.module.ts` registers none). `GET /healthz` (`src/health/`) is the endpoint pattern to
mirror for `GET /metrics`. RAG-63 **wraps** these existing signals with request context and
metrics — it does not replace the log lines.

---

## 1. Three pillars

1. **Metrics** — `prom-client` counters/histograms exposed at `GET /metrics` (Prometheus text).
2. **Tracing via correlation IDs** — one id per request, propagated through `AsyncLocalStorage`
   across ingest → retrieve → generate, stamped into every log line.
3. **Error surfacing** — a global exception filter that logs with the id, counts the error, and
   returns a structured body carrying the id.

---

## 2. Principles

- **Correlation ID everywhere, secrets nowhere.** Every log line inside a request carries the
  id; **no** metric label or log field ever contains a question's text, a chunk's content, or a
  key (rule `ai-and-secrets.md`).
- **Low label cardinality.** Routes are templated (`/query`, not the body); outcomes are a small
  enum. Never label by raw user input — that explodes a Prometheus series.
- **Abstain is a success, not an error.** `abstained: true` is a normal `200` and a distinct
  metric outcome (`grounded` vs `abstained`) — it must **never** increment the error counter or
  render as a 5xx. This mirrors the UI guide's "honesty is a first-class state."
- **Both entrypoints.** Correlation works for HTTP (middleware) *and* the CLI (wrap the command
  in an ALS scope) so `rag query` logs correlate too. `/metrics` is HTTP-only — fine; the CLI is
  short-lived.
- **Wrap, don't rewrite.** Reuse the RAG-42 log lines; add context and counters around them.

---

## 3. Correlation IDs (tracing)

- An `AsyncLocalStorage<{ correlationId: string }>` store is the request context.
- **HTTP:** a middleware honors an inbound `x-request-id` if present, else generates a
  `randomUUID()`, runs the request inside `als.run({ correlationId }, next)`, and echoes it on
  the response `x-request-id` header.
- **Logging:** a thin custom logger (or a wrapper) reads the id from ALS and prefixes each line,
  so the existing counts+latency logs become correlated with zero call-site changes.
- **CLI:** `src/cli/main.ts` wraps each command body in `als.run({ correlationId: randomUUID() })`
  so a single `rag ingest`/`rag query` invocation shares one id.
- **Surfaced to the UI:** the id is returned in the error body (§5) and header so the UI's
  `ErrorState` can show "trace id: …" (GO-21e-h).

---

## 4. Metrics — the `GET /metrics` series

`prom-client` default registry; `collectDefaultMetrics()` for process/GC. Endpoint mirrors
`/healthz`. The domain series (low-cardinality labels only):

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `rag_http_requests_total` | counter | `route,method,status` | request volume |
| `rag_http_request_duration_seconds` | histogram | `route` | end-to-end latency |
| `rag_ingest_docs_total` / `rag_ingest_chunks_total` | counter | — | ingestion throughput |
| `rag_retrieval_score` | histogram | — | top-hit similarity distribution (feeds floor tuning) |
| `rag_query_total` | counter | `outcome` = `grounded`\|`abstained` | query outcomes (abstain ≠ error) |
| `rag_generation_duration_seconds` | histogram | `provider` | model latency by provider |
| `rag_errors_total` | counter | `type` | surfaced unhandled errors (§5) |

> Label discipline: `route` is the templated path, `provider` is `anthropic`/`openai-compatible`,
> `outcome`/`type` are fixed enums. Nothing user-derived. Keep total series small.

---

## 5. Error surfacing

A global `AllExceptionsFilter`:

- Catches unhandled exceptions, logs with the correlation id + stack (never a secret).
- Increments `rag_errors_total{type}` (`type` from the exception class — a fixed set).
- Returns a structured body: `{ statusCode, message, correlationId }` (and the `x-request-id`
  header), so a failed `/query` is traceable end-to-end and the UI can show the id.
- **Expected control flow is not an error:** `BadRequestException` (validation) is a normal `4xx`
  and abstain is a normal `200` — neither bumps `rag_errors_total`. Only unexpected faults do.

---

## 6. Config & seams

- Env: `METRICS_ENABLED` (default `true`) to gate the `/metrics` route and collectors; no new
  secrets. `@nestjs/config`, sane defaults (rule `coding-standards.md`).
- **OTel seam (not built):** keep the correlation-ID generation and the metrics registry behind
  small internal modules so a later swap to OpenTelemetry traces/OTLP export is additive, not a
  rewrite. Documented as future work, consistent with the adapter-seam discipline elsewhere.

---

## 7. Definition of done (when the code is built — not this planning slice)

1. `GET /metrics` returns Prometheus text with the §4 series; they move under load.
2. Every log line within one request/CLI invocation shares a correlation id; it's returned on
   `x-request-id` and in the error body.
3. Unhandled errors return `{ statusCode, message, correlationId }` and bump `rag_errors_total`;
   **abstain and 4xx validation do not**.
4. Unit tests (exception filter, correlation propagation, metrics registry) + a live smoke:
   request → correlated logs + populated `/metrics` + a forced structured error.
5. Codemap + `doc/LEARNINGS.md` updated (new modules/routes/env). **Not retrieval-affecting**
   (no chunking/k/floor/embedding change) → **no eval run required** (`[eval-ok]`), per rule
   `evals.md`.
6. Gate lifted: with this landed, **GO-21e (the UI) is unblocked.**
