# GO-21e — Minimal chat UI (React + Vite, full polish)

> Parent: a single-page chat UI over `POST /query` that renders grounded, cited answers and
> honest abstain/uncited states. Source: `PRD` FR-5, `TDD` §2.7, `tasks.md` RAG-31/32/33.
> **Stack + polish decided 2026-07-23:** React 18 + Vite + TypeScript, full portfolio-grade
> polish (a deliberate revisit of the PRD "no UI polish" non-goal for the demo).
> **Design guide to follow:** [`docs/ui-design-guide.md`](../docs/ui-design-guide.md).

> ✅ **Gate lifted 2026-07-28 — RAG-63 (observability framework) landed.** Tracing / metrics /
> error surfacing are in place, so GO-21e-b … h are unblocked. The correlation id is surfaced in
> the error body (`{statusCode, message, correlationId}`) — exactly what GO-21e-h's `ErrorState`
> shows. GO-21e-a (the design guide) was the only pre-gate-safe step; the rest can now proceed.

| ID | Sub-task | Done when | Depends on |
|----|----------|-----------|------------|
| GO-21e-a | **Write & commit the UI design guide** — tokens, component set, citation interaction, the four render branches, tech/integration | `docs/ui-design-guide.md` committed and reviewed | — *(done 2026-07-23)* |
| GO-21e-b | **Scaffold `web/` (React + Vite + TS)** — Vite dev proxy `/query` → Nest, lint/format, `web/src/types.ts` mirroring the `QueryResult` contract, one typed `fetchQuery()` | `npm run dev` in `web/` serves a shell that can call `/query` in dev; types compile against the server contract | RAG-63 (gate) — *(done 2026-07-29)* |
| GO-21e-c | **Implement design tokens + `AppShell`** — CSS vars for both themes, type/spacing scale, `Header` + `StatusBadge` + `Composer` + `EmptyState` per the guide | Empty shell matches the guide's layout at desktop + mobile, light + dark; composer autofocused, `⌘/Ctrl+Enter` wired | GO-21e-a, GO-21e-b — *(done 2026-07-29)* |
| GO-21e-d | **Build the query happy path** — composer → `POST /query` → render `answer`; `LoadingAnswer` skeleton/caret while in flight | Asking a question returns and renders a grounded answer with no layout shift | GO-21e-c · **satisfies RAG-31** — *(done + live-verified 2026-07-29 against the key-free stack)* |
| GO-21e-e | **Render the honest states** — `AbstainCard` (`--info`, verbatim message), `ErrorState` (`--danger`, retry), `CapabilityNote` when `!citationsSupported` | All four §6 branches + loading/error render distinctly; abstain is not styled as an error | GO-21e-d — *(code-complete 2026-07-29; typecheck/lint/build green — live visual check pending a stack run)* |
| GO-21e-f | **Render citations + Sources** — numbered citations (grouped, Radix popover for `citedText`/`source`, mapped via `documentIndex`) + a collapsible `SourcesPanel` (`chunks[]` + `ScoreBar`) | Clicking a citation reveals its source span and highlights the matching chunk; sources list shows every retrieved chunk with score | GO-21e-d · **satisfies RAG-32** — *(code-complete 2026-07-29; **grouped, not inline-at-span** per user decision — contract carries no answer offsets; live visual check pending)* |
| GO-21e-g | **Serve the built UI from Nest** — `vite build` → served via `useStaticAssets` (matches existing main.ts; no new dep vs the guide's serve-static suggestion), same-origin (no CORS), inside Docker | `docker compose up` serves the UI at `/` querying the same-origin API; cold-start → cited answer <60s; one-command run intact | GO-21e-d · **satisfies RAG-33** — *(done + live-verified 2026-07-29: `/` serves the React build, `/assets/*` 200, same-origin `/query` grounded, cold start ~25s)* |
| GO-21e-h | **Full-polish + a11y pass** — motion budget (reduced-motion aware), focus rings, keyboard nav, AA contrast, responsive/mobile check, observability correlation-id surfacing (RAG-63) | Keyboard-only flow works, `prefers-reduced-motion` honored, AA verified in both themes, correlation id shown on error | GO-21e-e, GO-21e-f |
| GO-21e-i | **History drawer** *(added 2026-07-29 by user request)* — collapsible left drawer (burger-toggled, collapsed by default) with a **persisted** (localStorage) list of past questions: New/select/remove/clear; `state.ts` reworked to a `history: Exchange[]` + `activeId` model, render branch derived (`phaseOf`) | Burger opens/closes the drawer; asking questions builds a history that survives reload; selecting one shows its answer; clear/remove work | GO-21e-c — *(done 2026-07-29)* |

**Open decisions:** none blocking. Stack (React+Vite) and polish level (full) are decided.
The one hard **gate** was RAG-63 (observability) before GO-21e-b onward — lifted 2026-07-28.
**Scope revisit (2026-07-29):** question-history *persistence* was pulled back **into** scope
(GO-21e-i, guide §2/§4/§8) as a navigable list of independent Q&As — *not* multi-turn chat
memory. Streaming tokens, conversation memory, auth, and multi-corpus switching stay out.

**Start here:** GO-21e-a/b/c/i are **done** (2026-07-29): design guide, `web/` scaffold, design
tokens + `AppShell` (both themes, autofocus + ⌘/Ctrl+Enter), and the persisted history drawer.
**GO-21e-d** (query happy path — `Conversation`/`Message`/`AnswerBody`/`LoadingAnswer`; satisfies
RAG-31) is **done + live-verified** (2026-07-29). **GO-21e-e** (honest states — `AbstainCard`,
`ErrorState` with retry, `CapabilityNote`) is **code-complete** (2026-07-29; build green, live
visual check pending). **GO-21e-f** (citations + `SourcesPanel` — grouped numbered citations with
Radix popovers, `ScoreBar`, cited/un-cited chunks; satisfies RAG-32) is **code-complete**
(2026-07-29; **grouped not inline-at-span** per user decision — no answer offsets in the
contract). **GO-21e-g** (serve the built UI from Nest; satisfies RAG-33) is **done + live-verified**
(2026-07-29). The next (final) move is **GO-21e-h** (full-polish + a11y pass).
