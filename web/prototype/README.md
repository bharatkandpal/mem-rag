# UI design prototype — evaluation spike

A **self-contained, animated prototype** of the chat UI for evaluating the *initial design and
its motion* — open `index.html` in any browser, no build, no backend (mock `/query` data).

It embodies [`docs/ui-design-guide.md`](../../docs/ui-design-guide.md): the token system (light
+ dark), the four render branches, and full-polish animations — in a **three-pane layout**:
**left = chat history · center = conversation · right = citation references** (toggle either
sidebar with the ☰ / ⧉ header buttons; both auto-collapse on narrow widths).

**What to evaluate**
- Type a question (or use the example chips), or flip the **Preview state** control to see each
  of the four branches: **Grounded** (inline citations + populated References sidebar),
  **Abstain**, **Uncited** (honest capability note + retrieved context), **Error** (with trace id).
- **References sidebar** cross-links with the answer: click a `¹²³` marker to highlight its
  reference (and vice-versa); "Also retrieved" shows uncited chunks with scores.
- **Chat history** (left): "＋ New chat" resets, and clicking a past item loads its exchange.
- **Animations to judge:** message enter (fade+rise), the retrieving/generating loader
  (bouncing dots + shimmer skeleton), the answer reveal caret, citation-marker → popover
  (scale-in) with source-chunk highlight, and score-bar fills. Toggle the theme (◐). Respects
  `prefers-reduced-motion`.

**Status / scope**
- This is a **design spike, not the production build.** The eventual UI is a React + Vite app at
  `web/` (GO-21e-b…), still gated on RAG-63 (observability). The CSS variables, layout, and
  keyframes here port directly into that build — this is where we settle the *look* first.
