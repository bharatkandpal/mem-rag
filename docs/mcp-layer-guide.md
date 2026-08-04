# GO-21i / RAG-65 — MCP Server Layer: Design Guide (accepted)

> **Status: ✅ BUILT (2026-08-04) — RAG-65a…f all shipped.** stdio + Streamable-HTTP transports,
> `rag_query` + gated `rag_ingest`, bearer auth, both-provider citation-serialization tests, and an
> answer-eval pass through the tool (10/10 answerable grounded, abstain matches the direct path). See
> the §8 table for per-slice status; README §8 documents the entrypoint. This is the
> finalized design for the MCP layer. It supersedes the open decisions in the plan-first draft
> ([`superpowers/plans/2026-07-17-mcp-layer.md`](superpowers/plans/2026-07-17-mcp-layer.md)) —
> D1–D5 are now resolved (§5) and the tool surface / serialization / transport / auth are pinned
> against the real service contracts and the current Anthropic MCP shapes. Mirrors the approach-note
> pattern of [`ui-design-guide.md`](ui-design-guide.md), [`observability-guide.md`](observability-guide.md),
> and [`embeddable-scaffold-guide.md`](embeddable-scaffold-guide.md).

**Goal.** Expose the RAG pipeline as an **MCP server** so any MCP-capable agent (Claude Desktop,
Claude Code, custom agents, or Anthropic's API MCP connector) can ask citation-grounded questions
over the corpus — a **third entrypoint over the same in-process NestJS services**, alongside the
HTTP API (GO-21a–d) and the CLI (GO-21h). The MCP server is a thin protocol adapter; no pipeline
logic is duplicated, exactly as the CLI is.

**Why.** It turns the project from "a RAG app" into "a retrieval *tool* an agent can call" — the
strongest strategic signal in the roadmap (D8, multi-agent). It also re-exercises the architectural
thesis the whole project sells: clean seams, owned code, no framework lock-in.

---

## 1. Architecture — a third entrypoint, not a new pipeline

The load-bearing constraint (mirrors the CLI): the MCP server **resolves the existing services from
a Nest application context and calls them in-process** — no HTTP hop, no re-implemented
chunking / retrieval / generation.

```
                         ┌───────────────────────────────┐
   HTTP  (controllers) ─▶│                               │
   CLI   (commander)   ─▶│  IngestionService             │
   MCP   (this doc)    ─▶│  GenerationService            │─▶ Retrieval → pgvector
                         │   (retrieve → abstain → gen)  │─▶ Voyage / Anthropic adapters
                         └───────────────────────────────┘
```

- **Entrypoint:** `src/mcp/main.ts` — boots `NestFactory.createApplicationContext(AppModule, { logger: false })`
  (identical bootstrap to `src/cli/main.ts` and `eval/run-eval.ts`), resolves `GenerationService`
  (and, gated, `IngestionService`), and hands them to the MCP server wiring.
- **No business logic in the MCP layer.** It maps MCP tool calls → service calls → MCP results. The
  abstain policy, citation mapping, and provider selection all stay where they already live
  (`GenerationService` + adapters). Same "controllers are thin" rule (`coding-standards.md`), new
  transport.
- **Reuse the observability seam for stdout-safety (see §5, D3).** RAG-63g already produced a
  `CorrelatedLogger('stderr')` that the CLI attaches via `app.useLogger(...)`; the MCP entrypoint
  reuses it verbatim so structured logs never corrupt the stdio JSON-RPC channel. This is a *reuse
  point, not new code* — the observability milestone already solved this exact problem for the CLI.

---

## 2. The real service contracts this layer serializes

Pinned against the current code (not the draft's summary — the draft under-listed the fields):

```ts
// src/generation/generation.service.ts
interface QueryResult {
  answer: string;
  citations: Citation[];       // [] on abstain and on non-citation providers — never fabricated
  chunks: RetrievedChunk[];    // [] on abstain
  abstained: boolean;          // ← not in the draft; distinguishes abstain from a grounded answer
  citationsSupported: boolean; // provider capability flag (D4 update) — false ≠ a failure
  grounded: boolean;           // ← not in the draft; true only for corpus-grounded answers
}

// src/generation/generation-provider.interface.ts
interface Citation { citedText: string; source: string; documentIndex: number; }

// src/vector-store/vector-store.interface.ts
interface RetrievedChunk { content: string; source: string; score: number; }
```

`GenerationService.generate(question)` owns the **abstain-on-empty-retrieval** policy (D5): if no
chunk clears `MIN_SCORE`, it returns `{ answer: "I don't have that information in the corpus.",
citations: [], chunks: [], abstained: true, grounded: false, citationsSupported }` **without calling
the model**. The MCP layer inherits this for free and must surface it honestly (§4).

> **Design consequence:** the MCP `rag_query` result **must carry `abstained` and `grounded`** so a
> programmatic agent can branch on "is this from the corpus?" without string-matching the answer
> text. This is the single most important correction to the draft's proposed return shape.

---

## 3. Tool surface

Two tools, minimal by design (a small, well-described tool set → better model tool selection).

### `rag_query` — the headline tool
- **Description (drives tool-selection; be prescriptive about *when*):** *"Answer a question using
  only the ingested document corpus, returning a grounded answer with citations to source passages.
  Call this when the user asks something the corpus would contain. It returns a `grounded: false`
  'not in the corpus' result rather than guessing — treat that as a real answer, not an error."*
  (Prescriptive "call this when…" descriptions measurably lift should-call rate on current Opus
  models — see `claude-api` › tool-use-concepts.)
- **Input:** `{ question: string }`.
- **Output:** the full `QueryResult` as **structured content + a text rendering** (§4).
- **Abstain preserved for free** — lives in `GenerationService` above the provider (§2).

### `rag_ingest` — secondary, gated
- **Description:** *"Chunk, embed, and index the documents under a filesystem path into the corpus
  (idempotent)."*
- **Input:** `{ path: string }`.
- **Output:** ingest stats `{ docs, chunks, ms }`.
- ⚠️ Exposing filesystem-write ingestion to an arbitrary agent is a capability grant — **gated behind
  `MCP_ENABLE_INGEST` (default `false`)** (§5, D2). The shipped server is query-only unless an
  operator turns writes on.

### Explicitly out of v1
- **The ungrounded general-knowledge path (`generateGeneral` / `POST /query/general`) is NOT exposed.**
  Per `ai-and-secrets.md`, the general path is a *user-initiated opt-in after an abstain* — an
  autonomous agent is not a user making that opt-in, and an MCP tool that silently returned
  non-corpus answers would let an agent present ungrounded text as if it came from the corpus. The
  honest MCP behaviour is: `rag_query` abstains, and the *calling agent's* human operator decides
  what to do next. Revisit only if a concrete, explicitly-labelled use case appears.
- **MCP resources & prompts** (readable context / templates) — tools are the whole value here. Later,
  maybe expose source documents as MCP *resources*; not v1.

---

## 4. Mapping our citations into MCP results (the one part with real design content)

Everything else is plumbing; this is the design.

- Our `AnthropicGenerationProvider` already normalizes Claude's native citations — the API returns
  `text` blocks whose `citations[]` carry `cited_text`, `document_index`, `document_title`, and a
  `char_location` (`start_char_index` / `end_char_index`) — into our own `Citation`
  (`{ citedText, source, documentIndex }`) mapped back to the source chunk. The MCP layer consumes
  the **normalized** `QueryResult.citations`; it never re-derives citations from the model.
- **MCP has no first-class "citation" type**, so grounding must survive the boundary another way. We
  return **both** representations (D1):
  1. **Structured content** — the full `QueryResult` JSON (`answer`, `citations`, `chunks`,
     `abstained`, `grounded`, `citationsSupported`) so a programmatic agent renders citations itself.
  2. **Text rendering** — the `answer`, then a trailing numbered
     `[n] "<citedText>" — <source>` source list, for clients that only render text.
  This is the no-information-lost option and the recommended target.
  **Implementation note (RAG-65b):** the source list is *trailing only*, not inline
  `[n]` markers in the prose. Our `Citation` carries the **source** span
  (`citedText`/`documentIndex`), not an offset into the answer text, so there is no
  faithful position to inject a marker mid-sentence — synthesizing one would fabricate
  provenance. Agents that need structure read `structuredContent` instead.
- **Non-citation providers** (the `openai-compatible` adapter → `supportsCitations: false`, e.g. the
  key-free local-LLM bundle from RAG-67) must surface `citationsSupported: false` and `citations: []`
  through MCP and **never fabricate a citation** (`ai-and-secrets.md`). The MCP layer inherits this
  because it reads `QueryResult` — it does not synthesize citations. The text rendering simply omits
  markers when `citations` is empty.

> **SDK pin-point:** the exact structured-content field on an MCP tool result depends on the installed
> `@modelcontextprotocol/sdk` version. **Confirm the structured-vs-text result API against the pinned
> package at build time** (RAG-65a) before finalizing the `rag_query` return shape — do not code it
> from memory; the SDK surface drifts.

---

## 5. Open decisions — RESOLVED

| # | Decision | Resolution |
|---|----------|-----------|
| **D1** | Result shape for `rag_query` | **Both** — structured content (full `QueryResult`, incl. `abstained`/`grounded`) **+** a text rendering with `[n]` markers. Confirm the SDK's structured-content API first (§4). |
| **D2** | Expose `rag_ingest`? | **Yes, but gated** — behind `MCP_ENABLE_INGEST` (default `false`). Query-only out of the box. |
| **D3** | Logging under stdio | **Route logs to stderr** — reuse the existing `CorrelatedLogger('stderr')` (RAG-63g) via `app.useLogger(...)`, exactly as the CLI does. stdout stays the pure JSON-RPC channel. Hard correctness requirement, not a preference. |
| **D4** | Auth | **stdio: none** (parent-process trust). **Streamable HTTP: bearer token**, secret from env only (`MCP_AUTH_TOKEN`, `ai-and-secrets.md`). This matches the Anthropic MCP connector's `authorization_token` field on the server declaration (§6). |
| **D5** | Eval required? | **No `npm run eval`** — MCP is a transport over the *existing* retrieval/generation path; it changes no chunking / `k` / `MIN_SCORE` / embeddings / index params (`evals.md`, same reasoning as the CLI). An **`answer-eval` pass** after `rag_query` is wired is expected, to confirm grounding + abstain survive the new serialization (mirrors the generation-provider note in `tasks.md`). Commit with `[eval-ok]`. |

---

## 6. Transport — verified against the current Anthropic MCP shapes

MCP defines two transports; support both, because they serve the two consumers.

| Transport | Who uses it | Notes |
|-----------|-------------|-------|
| **stdio** | Local agents — Claude Desktop, Claude Code, `npx` spawns | Server is a subprocess; JSON-RPC over stdin/stdout. **stdout is reserved for the protocol** → logs to stderr (D3). Primary / default transport. |
| **Streamable HTTP** | Remote agents, and **Anthropic's API MCP connector** | The MCP spec's SSE-only transport is deprecated — implement **Streamable HTTP**, not legacy SSE. |

**Reachability by Anthropic's API MCP connector (verified via `claude-api`):** the connector is
Anthropic's API acting as an MCP *client* that consumes a `{ type: "url", url, name,
authorization_token? }` server. A caller wires it with **two paired parameters** on
`client.beta.messages.create(...)`, beta header **`mcp-client-2025-11-20`**:

```jsonc
mcp_servers: [{ "type": "url", "url": "https://<our-host>/mcp", "name": "rag",
               "authorization_token": "<bearer>" }],
tools:       [{ "type": "mcp_toolset", "mcp_server_name": "rag" }]   // must reference the server by name
```

So for our server to be connector-reachable it must expose **Streamable HTTP** with an **optional
bearer token** — which is exactly D4. (Availability note from `claude-api` › platform-availability:
the MCP connector is beta on the first-party API, Claude Platform on AWS, and Microsoft Foundry;
**not** on Amazon Bedrock or Vertex — irrelevant to our server, but worth knowing for anyone wiring
the connector.)

**Recommendation:** ship **stdio first** (v1 — unblocks Claude Desktop/Code, the cheapest win), add
**Streamable HTTP + bearer auth** in a follow-up slice so the same server is reachable by the
connector and remote agents. Select the transport via `MCP_TRANSPORT=stdio|http` (default `stdio`),
keeping a single entrypoint.

---

## 7. Dependencies & guardrails

- **New dependency:** `@modelcontextprotocol/sdk` (official TypeScript MCP SDK). This is a **protocol**
  SDK, not a RAG framework — it does not violate "no LangChain/LlamaIndex" (`coding-standards.md`);
  it is the MCP equivalent of `commander` for the CLI. **Confirm the current `McpServer` /
  tool-registration / transport API against the installed package version at build time** — do not
  code registration or transport calls from memory; the surface drifts.
- **Config via `@nestjs/config`** — `MCP_TRANSPORT`, `MCP_ENABLE_INGEST`, `MCP_HTTP_PORT`,
  `MCP_AUTH_TOKEN` are env-driven with sane defaults; no magic constants (`coding-standards.md`).
  Add them to `.env.example` with placeholders (`MCP_AUTH_TOKEN` documented, never a real value).
- **Secrets env-only** — `MCP_AUTH_TOKEN` never committed/logged (`ai-and-secrets.md`).
- **Codemap + tests + learnings** — new module/entrypoint/symbols → update `doc/codemap.md` in the
  same change; unit-test the tool-call → service-call mapping (mock the services) and the citation
  serialization (both provider types); append a `doc/LEARNINGS.md` entry per slice.

---

## 8. Build slices (ready to cut as `RAG-65a…`)

Each has a concrete "done when". Not retrieval-affecting → `[eval-ok]` on every commit; the
`answer-eval` pass lands in the last slice.

| ID | Slice | Done when |
|----|-------|-----------|
| **RAG-65a** ✅ | **Entrypoint + SDK pin** — `src/mcp/main.ts` app-context bootstrap (`createApplicationContext`, `useLogger(new CorrelatedLogger('stderr'))`), resolve `GenerationService`; add `@modelcontextprotocol/sdk`; confirm `McpServer` / tool-registration / structured-content API against the installed version. No tools yet. | **Done 2026-08-03.** `@modelcontextprotocol/sdk@1.30.0` (exact-pinned; API confirmed: `registerTool`/`new McpServer({name,version})`/`StdioServerTransport`/Zod shapes). `npm run mcp` added; `tsc`+`nest build` clean. **Live-verified:** an `initialize` handshake returns `serverInfo {name:"rag", v0.1.0}` + negotiated protocol on **stdout**, readiness log on **stderr**, stdout protocol-only, 0 tools (empty server). |
| **RAG-65b** ✅ | **`rag_query` over stdio** — register the tool, call `GenerationService.generate`, return **structured `QueryResult` + text rendering** (`[n]` markers + source list); abstain preserved. | **Done 2026-08-03.** `src/mcp/rag-query.tool.ts` (`registerQueryTool`) + `src/mcp/render.ts` + 4 renderer unit tests. Structured `QueryResult` (Zod `outputSchema`) **+** text with a numbered `Sources:` list. **Deviation:** trailing source list, *not* inline `[n]` markers — `Citation` carries the source span, not an answer offset (see §4 / LEARNINGS). **Live-verified** via a real stdio MCP `Client` over the seeded corpus + qwen2.5:3b: grounded question → `grounded:true` + retrieved chunk + model answer; out-of-corpus → `abstained:true`/`grounded:false` + verbatim message, no Sources. `citations:[]`/`citationsSupported:false` on the local provider is correct (native citations are Claude-only — the citation *mapping* is unit-tested in RAG-65c). |
| **RAG-65c** ✅ | **Citation serialization + unit tests (both provider types)** — assert Anthropic path emits `citations[]` mapped to sources; assert `openai-compatible` path returns `citationsSupported:false` + `citations:[]` and the text rendering omits markers. | **Done 2026-08-04.** `src/mcp/rag-query.tool.spec.ts` (7 tests): captures the tool handler via stub `McpServer`+`GenerationService`. Anthropic → `citations[]` mapped to sources in `structuredContent` + numbered `Sources:` text; openai-compatible → `citationsSupported:false`+`citations:[]`, no `[n]` markers, capability note (never fabricated — negative assertions); abstain pass-through. Provider-level Claude→`Citation` mapping stays tested in `anthropic-generation.provider.spec.ts`. 149 tests green. |
| **RAG-65d** ✅ | **`rag_ingest` behind `MCP_ENABLE_INGEST`** — register only when the flag is on; call `IngestionService`, return `{docs,chunks,ms}`. | **Done 2026-08-04.** `src/mcp/rag-ingest.tool.ts` (`registerIngestTool`, input `{path}` → output `{docs,chunks,ms}`) + `src/mcp/register-tools.ts` (`registerTools` holds the gate — pure fn, unit-tested) + `MCP_ENABLE_INGEST` env (default false, in `.env.example`). 4 new unit tests (handler + gate). **Live-verified** via a real stdio MCP `Client`: flag off → `tools/list` = `[rag_query]` (ingest absent); flag on → `rag_ingest` present + a real ingest returned `{docs:4, chunks:9}`, idempotent re-run stable at 9. |
| **RAG-65e** ✅ | **Streamable HTTP transport + bearer auth** — `MCP_TRANSPORT=http`, `MCP_HTTP_PORT`, `MCP_AUTH_TOKEN` bearer check. | **Done 2026-08-04.** `src/mcp/http-transport.ts` (self-contained `http.createServer` on `/mcp`, `StreamableHTTPServerTransport` stateless per-request, constant-time bearer) + `src/mcp/config.ts` (`resolveMcpServerConfig`, **fail-closed** — http without a token throws). `main.ts` branches on `MCP_TRANSPORT` (same `registerTools` set). 13 unit tests + `.env.example`. **Live-verified:** curl → 401 (no/wrong token), 404 (off-path); SDK `StreamableHTTPClientTransport` with the correct bearer → `tools/list`, grounded `rag_query` (`grounded:true`+chunk) and abstain over HTTP; wrong bearer rejected at connect. **Note:** built to the connector's `{type:"url", url, authorization_token}` + `mcp_toolset` shape (§6); the *hosted* connector hop needs a public URL + keys (RAG-34..37 / GO-21f) — the local Streamable-HTTP client exercises the identical transport + auth. |
| **RAG-65f** ✅ | **`answer-eval` pass + docs + wrap-up** — run `answer-eval` to confirm grounding/abstain survive serialization; README "third entrypoint" section; `doc/codemap.md` + `doc/LEARNINGS.md`. | **Done 2026-08-04.** Answer-eval (abstention-correctness axis) run through the `rag_query` tool over the live stack: **10/10 answerable stay grounded, 4/6 abstain — reproducing the documented direct-`/query` baseline** (same two RAG-57 tech-adjacent leaks), which is the proof serialization didn't alter outcomes. README §8 "Expose the corpus to AI agents (MCP)" added + architecture updated to three entrypoints. LEARNINGS wrap-up appended. Judge-scored groundedness/citation axes need Anthropic keys (deferred to a keyed run; serialization faithfulness already unit-proven in RAG-65c). |

---

*Ties into: GO-21h (CLI — the sibling in-process entrypoint), RAG-63 (the stderr-logger reuse point),
RAG-60/67 (the non-citation provider path this must honour), D8 (multi-agent, the direction this
enables), and `ai-and-secrets.md` (abstain + no-fabricated-citations + general-path opt-in, inherited
unchanged).*
