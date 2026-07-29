/**
 * The `/query` response contract — a mirror of `QueryResult` in
 * `src/generation/generation.service.ts` (the server is the source of truth).
 * Keep this in lockstep with it; the UI is a pure function of this shape
 * (design guide §0). A single `fetchQuery()` (see `api.ts`) is the only place
 * this crosses the network.
 */

/** A native citation span, mapped back to the source chunk it was drawn from. */
export interface Citation {
  /** The exact quoted span. */
  citedText: string;
  /** Provenance of the chunk the citation points at (filename / URL). */
  source: string;
  /** Index into `chunks[]` of the chunk this span came from. */
  documentIndex: number;
}

/** A retrieval hit: the chunk's text, its provenance, and cosine similarity. */
export interface RetrievedChunk {
  content: string;
  source: string;
  score: number;
}

/** The full `POST /query` result. */
export interface QueryResult {
  /** The grounded answer, or the verbatim abstain message when `abstained`. */
  answer: string;
  /** Native citation spans — empty unless the provider supports citations. */
  citations: Citation[];
  /** What retrieval returned (populated even when the answer cites nothing). */
  chunks: RetrievedChunk[];
  /** true → "not in the corpus" (a good outcome, not an error). */
  abstained: boolean;
  /** false → the answer stands, the provider just can't cite (RAG-62). */
  citationsSupported: boolean;
  /**
   * true for corpus-grounded answers (the default). false for the explicit
   * opt-in general-knowledge answer and for abstentions.
   */
  grounded: boolean;
}
