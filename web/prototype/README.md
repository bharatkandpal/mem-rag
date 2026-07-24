# UI design prototype — evaluation spike

A **self-contained, animated prototype** of the chat UI for evaluating the *initial design and
its motion* — open `index.html` in any browser, no build, no backend (mock `/query` data).

It embodies [`docs/ui-design-guide.md`](../../docs/ui-design-guide.md): the token system (light
+ dark), the citation-first layout, the four render branches, and full-polish animations.

**What to evaluate**
- Type a question (or use the example chips), or flip the **Preview state** control to see each
  of the four branches: **Grounded** (inline citations + Sources panel), **Abstain**, **Uncited**
  (honest capability note), **Error** (with trace id).
- **Animations to judge:** message enter (fade+rise), the retrieving/generating loader
  (bouncing dots + shimmer skeleton), the answer reveal caret, citation-marker → popover
  (scale-in) with source-chunk highlight, and score-bar fills. Toggle the theme (◐). Respects
  `prefers-reduced-motion`.

**Status / scope**
- This is a **design spike, not the production build.** The eventual UI is a React + Vite app at
  `web/` (GO-21e-b…), still gated on RAG-63 (observability). The CSS variables, layout, and
  keyframes here port directly into that build — this is where we settle the *look* first.
