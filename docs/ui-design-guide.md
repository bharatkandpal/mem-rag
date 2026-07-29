# UI Design Guide — RAG Knowledge-Store Chat (GO-21e)

> The **initial design guide to follow** when building the chat UI. It fixes the visual
> language, component set, and — most importantly — how the `/query` contract is rendered,
> so implementation is a matter of executing a decided design, not re-deciding it mid-build.
>
> **Stack:** React 18 + Vite + TypeScript. **Ambition:** full polish (portfolio-grade).
> **Decided 2026-07-23.** This is a career-transition portfolio piece, so the demo's
> credibility matters — *full polish is a deliberate scope decision that revisits the PRD
> non-goal ("streaming UI polish, mobile")*. That trade is intentional and recorded here,
> not a silent contradiction of `PRD.md §2`.

---

## 0. What the UI actually renders — the `/query` contract

Everything below serves this shape. The design exists to make **this data** trustworthy and
scannable. Bind against the real contract (`src/generation/generation.service.ts`), don't
re-invent it:

```ts
POST /query { question }  →  QueryResult {
  answer: string;                                       // grounded answer OR the abstain message
  citations: {                                          // native Claude spans — empty unless supported
    citedText: string;                                  // the exact quoted span
    source: string;                                     // provenance (filename / URL)
    documentIndex: number;                              // → index into chunks[]
  }[];
  chunks: { content: string; source: string; score: number }[];  // what retrieval returned
  abstained: boolean;                                   // true → "not in the corpus" (a good outcome, not an error)
  citationsSupported: boolean;                          // false → answer stands, provider just can't cite (RAG-62)
}
```

Four render branches fall directly out of this — see **§6 States**. Getting these four right
*is* the UI; everything else is polish on top.

---

## 1. Design principles

1. **Citation-first, not chat-first.** The differentiator is *sourced* answers. Citations and
   retrieved chunks are primary UI, not a footnote. If a viewer can't tell *where the answer
   came from* in 3 seconds, the design failed.
2. **Honesty is a first-class state.** `abstained` ("not in the corpus") and
   `citationsSupported: false` are **not errors** — they're the product being trustworthy.
   Style them as calm, informational, even a little proud. Never red, never a shrug.
3. **Fast to first answer.** Success criterion is a cited answer in <60s from cold start
   (`PRD §5`). No onboarding, no modal, no login. The composer is focused on load.
4. **Calm, technical, credible.** Neutral surfaces, one confident accent, monospace for the
   machine artifacts (sources, scores, chunks). It should read like a well-built dev tool, not
   a consumer chatbot.
5. **Keyboard- and reduced-motion-friendly.** Full polish never comes at the cost of a11y —
   see §8.

---

## 2. Layout & information architecture

Single-column conversation, fixed composer, a collapsible **Sources** surface. Desktop-first,
gracefully responsive (§7).

```
┌───────────────────────────────────────────────────────────────┐
│  ◇ RAG · knowledge-store chat        [provider ●] [◐ theme]    │  ← Header: title, provider/citation badge, theme toggle
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   You ─────────────────────────────────────────────────────  │
│      How is retrieval scored?                                 │
│                                                               │
│   ◇ ─────────────────────────────────────────────────────    │
│      Retrieval scores each chunk by cosine similarity¹ over   │  ← Answer with inline numbered
│      the HNSW index², and applies a min-score floor³ …        │    citation markers ¹²³
│                                                               │
│      ▸ Sources (5)                              [grounded ✓]  │  ← Collapsible retrieved-chunks panel
│        ¹ TDD.md            ▓▓▓▓▓▓▓░░  0.71                     │    (chunks[] + score bars)
│        ² GO-21.md          ▓▓▓▓▓░░░░  0.58                     │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┐  ┌────────┐ │
│  │ Ask a question about the corpus…            │  │  Ask → │ │  ← Composer: textarea + submit
│  └─────────────────────────────────────────────┘  └────────┘ │    (⌘/Ctrl+Enter to send)
└───────────────────────────────────────────────────────────────┘
```

- **Header** — a **history burger** (far left), product name, a provider/citation **status badge**
  (from `citationsSupported`), theme toggle.
- **History drawer** *(added 2026-07-29 — see §8)* — a **collapsible left drawer**, collapsed by
  default, toggled by the header burger. Lists past questions (persisted across reloads), with
  "New question", per-item remove, and clear-all; selecting one shows that exchange. It overlays
  the shell (backdrop + Esc close) so the centered single column is unchanged when closed.
- **Conversation** — alternating user/assistant messages; the answer message owns the citation
  markers and the Sources panel.
- **Sources panel** — per-answer, collapsed by default, expands to the `chunks[]` list with
  source + score bars. This is the trust surface; make it feel earned, not noisy.
- **Composer** — pinned to the bottom, autofocused, multiline, `⌘/Ctrl+Enter` to send.

---

## 3. Visual language — design tokens

Define these once as CSS custom properties (or a Tailwind theme) and reference tokens only —
no raw hex in components. Both themes ship (full polish); default to the OS preference.

### Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAFAFA` | `#09090B` | App background |
| `--surface` | `#FFFFFF` | `#18181B` | Cards, messages, composer |
| `--surface-2` | `#F4F4F5` | `#27272A` | Sources panel, code/chunk bg |
| `--text` | `#18181B` | `#FAFAFA` | Primary text |
| `--text-secondary` | `#52525B` | `#A1A1AA` | Labels, meta |
| `--text-muted` | `#A1A1AA` | `#71717A` | Scores, timestamps, placeholders |
| `--border` | `#E4E4E7` | `#27272A` | Hairlines, dividers |
| `--accent` | `#4F46E5` | `#6366F1` | Interactive, citation markers, submit |
| `--accent-hover` | `#4338CA` | `#818CF8` | Hover/active |
| `--accent-subtle` | `#EEF2FF` | `rgba(99,102,241,.15)` | Citation highlight, focus ring bg |
| `--info` | `#475569` | `#94A3B8` | **Abstain** + capability notes (calm, not alarming) |
| `--info-subtle` | `#F1F5F9` | `#1E293B` | Abstain card background |
| `--success` | `#16A34A` | `#4ADE80` | "grounded ✓" indicator |
| `--danger` | `#B91C1C` | `#FCA5A5` | Genuine errors only (network/5xx) |
| `--danger-subtle` | `#FEF2F2` | `rgba(239,68,68,.12)` | Error card background |

> **Semantic rule:** `--danger` is reserved for *actual failures*. Abstain and
> no-citation-support use `--info`. This color discipline is what makes "honest" read as a
> feature rather than a fault.

### Typography

| Role | Family | Size / line-height |
|---|---|---|
| Sans (UI, answers) | `"Inter", system-ui, -apple-system, "Segoe UI", sans-serif` | body `1rem/1.6` |
| Mono (sources, scores, chunks) | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | `0.8125rem/1.5` |

Type scale (rem): `0.75` caption · `0.8125` mono · `0.875` body-sm · `1` body · `1.125` lead ·
`1.5` h2 · `2` h1. Answers get generous measure (max ~68ch) for readability.

### Spacing, radius, elevation

- **Space** (4px base): `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`.
- **Radius:** `sm 6` (chips) · `md 10` (cards/inputs) · `lg 16` (message bubbles) · `pill 9999`.
- **Shadow:** `sm 0 1px 2px rgba(0,0,0,.06)` · `md 0 4px 12px rgba(0,0,0,.08)` ·
  `popover 0 8px 24px rgba(0,0,0,.12)`.
- **Icons:** `lucide-react`, 1.5px stroke, sized to the type scale (16/20px).

---

## 4. Component inventory

Build in this order (mirrors the task ladder in `subtasks/GO-21e.md`). Each is small.

| Component | Responsibility | Key props / notes |
|---|---|---|
| `AppShell` | Theme provider, layout grid, header + scroll region + composer | Owns theme state, sets tokens on `:root` |
| `Header` | Title, `StatusBadge`, theme toggle | — |
| `StatusBadge` | Honest provider capability, from `citationsSupported` | `citations` (green dot) vs `no-citation` (info dot) |
| `Conversation` | Scrollable message list; autoscroll on new answer | list of `Message` |
| `Message` | User or assistant bubble | `role`, children |
| `AnswerBody` | Renders `answer` with inline citation markers | maps spans → `CitationMarker` (see §5) |
| `CitationMarker` | Superscript numbered marker `¹²³` | `index`, opens `CitationPopover`; keyboard-focusable |
| `CitationPopover` | Shows `citedText` + `source` for one citation | use Radix Popover for a11y |
| `SourcesPanel` | Collapsible `chunks[]` list, score bars, "grounded ✓" | collapsed by default; expand reveals chunks |
| `ChunkRow` | One retrieved chunk: mono source + `ScoreBar` + snippet | `source`, `score`, `content` |
| `ScoreBar` | Visual 0–1 similarity bar | width = `score`, accent fill |
| `AbstainCard` | The "not in the corpus" state | `--info`, informational icon, calm copy |
| `CapabilityNote` | "provider can't verify citations" note (RAG-62) | `--info`, only when `!citationsSupported && !abstained && answer present` |
| `ErrorState` | Network/5xx failure, retry, correlation id (§9) | `--danger` |
| `Composer` | Textarea + submit; `⌘/Ctrl+Enter`; disabled while loading | controlled input |
| `LoadingAnswer` | Skeleton / animated caret while awaiting `/query` | shimmer, reduced-motion aware |
| `EmptyState` | First load: one-line intro + 2–3 example questions | seeds the <60s path |
| `HistoryDrawer` | Collapsible left drawer: past questions (persisted), New/remove/clear | collapsed by default; header burger toggles; overlay + Esc (added 2026-07-29) |

---

## 5. The citation interaction (the core UX)

This is where the product earns trust — design it deliberately.

- **Inline markers.** Render `answer` as text with **superscript numbered markers** where each
  `citations[i]` applies. Number by citation order (`¹ ² ³`), and map `documentIndex` →
  `chunks[documentIndex]` for the source. (Claude returns `citedText` spans; align each marker
  to its span in the answer text.)
- **Hover / focus → popover.** A `CitationMarker` opens a `CitationPopover` showing the exact
  `citedText` (quoted) and its `source`. Clicking scrolls/expands the matching `ChunkRow` in the
  `SourcesPanel` and highlights it with `--accent-subtle`.
- **Sources panel is the receipts.** Every retrieved chunk (`chunks[]`) is listed with its
  `source` (mono) and `score` (via `ScoreBar`), so a viewer sees *both* what was cited and what
  was retrieved-but-not-cited. That transparency is the portfolio signal.
- **"grounded ✓"** micro-badge on an answer that has ≥1 citation. Absent (not red) when
  `citationsSupported` is false — pair with the `CapabilityNote` instead.

Accessibility: markers are real `<button>`s in the tab order, `aria-describedby` the popover;
popover is keyboard-dismissible (Esc). Use Radix Popover to get focus management for free.

---

## 6. States — the four render branches (bind to the contract)

The UI is a function of `QueryResult`. Enumerate every branch; each has a distinct, designed
state. This table *is* the acceptance spec for the query flow.

| Condition | State | Visual treatment |
|---|---|---|
| request in flight | **Loading** | `LoadingAnswer` skeleton/caret; composer disabled; no layout shift |
| `abstained === true` | **Abstain** | `AbstainCard`, `--info`, calm icon, the verbatim abstain message. **Not an error.** No citations, no sources panel. |
| `answer` + `citations.length > 0` | **Grounded answer** | `AnswerBody` with markers + `SourcesPanel` + "grounded ✓" |
| `answer` + `citations.length === 0` + `!citationsSupported` | **Answered, uncited (honest)** | `AnswerBody` (no markers) + `SourcesPanel` (chunks still shown) + `CapabilityNote` in `--info`. Never fabricate markers (RAG-62 / rule `ai-and-secrets.md`). |
| fetch throws / non-2xx | **Error** | `ErrorState`, `--danger`, retry + correlation id (§9). This is the *only* red state. |
| no query yet | **Empty** | `EmptyState` with example questions |

> Edge: `answer` present with `citations.length === 0` but `citationsSupported === true` (Claude
> chose not to cite / thin support) → render the answer plainly with the `SourcesPanel`, **no**
> capability note. Only show `CapabilityNote` when the *provider* can't cite.

---

## 7. Responsive

Desktop-first, but must not break on a phone (the demo link gets opened on mobile).

| Breakpoint | Layout |
|---|---|
| ≥ 960px | Centered column, max-width ~760px; popovers anchored to markers |
| 600–960px | Full-width column, 16px gutters |
| < 600px | Composer full-width sticky bottom; citation popovers become bottom sheets; Sources panel full-width |

---

## 8. Motion & accessibility (full-polish, done responsibly)

- **Motion budget:** micro-interactions `120ms`, element enter `200ms`, easing
  `cubic-bezier(0.16, 1, 0.3, 1)`. Answer message fades+rises in; popovers scale from the
  marker; loading uses a subtle shimmer/caret. Nothing longer than 250ms.
- **`prefers-reduced-motion`:** disable transforms/shimmer, keep instant opacity swaps.
- **Contrast:** all text/background pairs meet **WCAG AA**; verify accent-on-surface and the
  score-bar fill.
- **Focus:** visible `2px` `--accent` focus ring (`--accent-subtle` bg) on every interactive
  element; logical tab order composer → send → markers → sources.
- **Keyboard:** `⌘/Ctrl+Enter` sends; Esc dismisses popovers; Sources panel toggles with Enter/Space.
- **Screen readers:** answer region `aria-live="polite"` so a completed answer is announced;
  citation markers labelled `"citation N, source <file>"`.

> **Question history — now in scope (revised 2026-07-29).** Originally deferred, but reinstated
> for the portfolio demo: a persisted (localStorage) history of past questions in a collapsible
> left drawer (§2, §4). This is a **navigable list of independent Q&As**, not multi-turn chat
> memory — the backend `/query` stays single-shot and stateless; the drawer only re-displays a
> stored `QueryResult`. It does **not** reintroduce conversation memory, server-side sessions, or
> multi-corpus switching.
>
> **Still explicitly deferred (even at full polish):** token-by-token streaming, multi-turn
> conversation memory, auth, multi-corpus switching, i18n. Streaming stays out (matches `PRD §2`
> non-goals and keeps the request model simple); a `LoadingAnswer` caret gives the *feel* of
> responsiveness without a streaming endpoint.

---

## 9. Tech & integration

- **App:** React 18 + Vite + TypeScript under `web/`. State via `useReducer` — a list of
  `Exchange`es (question + `QueryResult`/error) + the active id; the history is persisted to
  `localStorage` and the active render branch is *derived* (`phaseOf`), not stored. Deps kept
  lean: `lucide-react` (icons), `@radix-ui/react-popover` (accessible citations). Tailwind
  optional for token wiring; plain CSS variables are fine.
- **Types:** mirror the server contract in `web/src/types.ts` (`QueryResult`, `Citation`,
  `RetrievedChunk`) — keep it in lockstep with `src/generation/generation.service.ts`. A single
  typed `fetchQuery(question): Promise<QueryResult>` wrapper is the only network surface.
- **Dev:** Vite dev server proxies `/query` → Nest (`vite.config.ts` `server.proxy`), so the
  browser talks same-origin in dev; no CORS.
- **Prod / one-command run:** `vite build` → static assets served **by Nest** via
  `@nestjs/serve-static` (RAG-33 / GO-21e-g), same origin as the API. `docker compose up` must
  still bring up a working UI at `/` with zero extra steps — that's the `PRD §5` promise; don't
  regress it with a second server.
- **Observability (gate):** UI work is **gated on RAG-63** (`tasks.md:62`). When it lands,
  surface the request **correlation id** in `ErrorState` and send it with each `/query` call so a
  failed answer is traceable end-to-end. An `ErrorBoundary` around `Conversation` catches render
  faults.

---

## 10. Definition of done for the UI (per the guide)

A build satisfies this guide when:

1. All **four render branches** in §6 (+ loading, empty, error) render distinctly and match the
   token system.
2. Citations are **never fabricated** — markers appear only from `citations[]`; abstain and
   uncited-honest states use `--info`, not `--danger` (rule `ai-and-secrets.md`).
3. Light **and** dark themes pass **AA** contrast; keyboard-only and reduced-motion flows work.
4. `docker compose up` serves the polished UI at `/`, same-origin, cold-start to cited answer in
   **<60s** — the `PRD §5` success criterion, unregressed.
5. The observability hook (correlation id surfacing) is wired once RAG-63 lands.
