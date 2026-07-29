# RAG-67 — Plug-and-play self-hosted bundle (`docker compose up`)

> Parent: a batteries-included, fully key-free default where one `docker compose up`
> brings the whole stack online (app + pgvector + **bundled** local model servers) with
> no external API keys, pre-seeded so a fresh boot answers a query out of the box —
> plus an opt-in `cloud` profile (Voyage + Anthropic, native citations).
> Source: `tasks.md` RAG-67 · GO-21k · PRD FR-7 · TDD §4 · rule `ai-and-secrets.md`.

**Already delivered (do not redo):**
- [x] Key-free compose overlay `docker-compose.local.yml` — transformers embeddings + `MIN_SCORE=0.60` + Ollama generation (currently **host** Ollama via `host.docker.internal`), blanked keys.
- [x] Container weight-cache blocker fixed — `TRANSFORMERS_CACHE=/hf-cache`, nonroot-owned, persisted via the `hfcache` volume. Verified key-free end-to-end; eval gate green.

**This file = the remaining work:** containerize Ollama (no host dependency), health-gate startup, first-boot seed, pin tags, cloud profile, verify + document.

> ✅ **DELIVERED 2026-07-28.** RAG-67a…g all done and **live-verified from a cold, keyless boot**: `/healthz` ok · first-boot seed `4 docs → 9 chunks` (no manual ingest) · grounded `/query` through the bundled `qwen2.5:3b` (`citationsSupported:false`) · abstain path (`"…not…in the corpus"`, 0 chunks) · re-seed idempotent (row count stable at 9). Files: `docker-compose.yml` (key-free default: `db`+`ollama`+`ollama-pull`+`seed`+`app`), `docker-compose.cloud.yml` (opt-in Voyage+Anthropic), `docker-compose.local.yml` removed. Tags pinned `pgvector/pgvector:0.8.1-pg16` + `ollama/ollama:0.32.1`. README self-host section rewritten; LEARNINGS appended. Not retrieval-affecting → `[eval-ok]`; no `src/`/`eval/` change → no codemap update.

| ID | Sub-task | Done when | Depends on |
|----|----------|-----------|------------|
| RAG-67a | **Decide the default-profile posture** — does the key-free bundled stack become the default `docker compose up` (GO-21k literal), or stay an opt-in profile with the Claude/cloud stack as the documented default? Weigh GO-21k ("key-free default") vs rule `ai-and-secrets.md` ("Claude ships out of the box"). Pick the file layout: single file + Compose `profiles` vs. base + overlays. | Decision recorded in this file: which command yields which stack, and the layout chosen. | — |
| RAG-67b | **Bundle Ollama as its own compose service** — `ollama/ollama` (pinned) with a named volume for models and an `/api/tags` healthcheck, plus a one-shot `ollama-pull` init that pulls `qwen2.5:3b` and exits. Repoint the app at `http://ollama:11434/v1`; drop `host.docker.internal` + `extra_hosts`. | Cold `up` stands the model server with **no host Ollama**; `curl ollama:11434/api/tags` lists the model. | RAG-67a |
| RAG-67c | **Health-gate the startup ordering** — app `depends_on` db `service_healthy`, ollama `service_healthy`, `ollama-pull` `service_completed_successfully`; seed after app is up. | A cold `up` never races — the app never queries before db + model are ready; `docker compose up` logs show ordered start. | RAG-67b |
| RAG-67d | **Add a first-boot seed one-shot** — a service reusing the app image + env + `hfcache` that runs `node dist/cli/main.js ingest /app/eval/sample-corpus` once, gated on db/app healthy; idempotent (RAG-19 — re-runs leave row count stable). | Fresh `up` from an empty volume → `/query "…"` returns a grounded answer with **zero manual ingest**. | RAG-67c |
| RAG-67e | **Pin all image tags** — pgvector, ollama, and the Dockerfile base (`node:22-alpine`) to specific versions (digests before publishing) for reproducibility. | No floating `latest`/rolling tags in any compose file or the Dockerfile; `docker compose config` shows pinned refs. | RAG-67b |
| RAG-67f | **Wire the opt-in `cloud` profile** (Voyage + Anthropic → native citations) per the RAG-67a posture. | The documented cloud command brings up the Claude stack with `citationsSupported: true`; the key-free command needs no keys. | RAG-67a |
| RAG-67g | **Verify end-to-end + document** — cold `up` (key-free) → seeded → grounded `/query` + abstain, no keys, no host Ollama; rewrite README "Run fully key-free" (drop the host-Ollama steps + the "remaining work" note); update `doc/codemap.md` (new script/env) + `doc/LEARNINGS.md`. | Smoke passes from a clean volume; README reflects the single-command reality; codemap + LEARNINGS updated; commit `[eval-ok]` (not retrieval-affecting). | RAG-67b, RAG-67c, RAG-67d, RAG-67e, RAG-67f |

**Decisions made:**
- **RAG-67a — RESOLVED 2026-07-28: key-free is the default.** Plain `docker compose up` brings up the fully key-free bundled stack (transformers embeddings + containerized Ollama, self-seeded, no keys). The cloud stack (Voyage + Anthropic, native citations) is **opt-in** via a standalone `docker-compose.cloud.yml`. The **code** default (`GENERATION_PROVIDER=anthropic`) is untouched — only the compose profile changes, which rule `ai-and-secrets.md` explicitly sanctions. Layout chosen: `docker-compose.yml` = self-contained key-free appliance (`db` + `ollama` + `ollama-pull` + `app` + `seed`); `docker-compose.cloud.yml` = standalone cloud path (avoids the `depends_on`-merge trap of an overlay). Host-Ollama "faster on Mac" stays a documented env-override tip, not a whole file.

**Open decisions:**
1. **RAG-67a — default-profile posture (gates layout).** GO-21k says the key-free stack is the *default* `docker compose up`; rule `ai-and-secrets.md` cautions against "silently changing what ships out of the box" (Claude is the code default). Reconcilable: the **code** default (`GENERATION_PROVIDER=anthropic`) stays untouched — this is only which compose *profile* is default, and swapping the configured provider via env is explicitly sanctioned. Recommendation: keep the key-free command one line, surface both clearly; lean on Compose `profiles` in one file so `docker compose --profile cloud up` vs. `docker compose up` reads cleanly.
2. **Mac GPU trade-off (flag, don't bury).** Containerized Ollama is CPU-only on Docker Desktop / Apple Silicon (no GPU passthrough) → slower than host Ollama. `qwen2.5:3b` is CPU-runnable, so accept it for the true one-command story and **keep the host-Ollama overlay documented as the "faster on Mac" variant**. Note this in the README, don't silently regress speed.
