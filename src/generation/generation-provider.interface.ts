import { RetrievedChunk } from '../vector-store/vector-store.interface';

/**
 * A citation a provider produced, mapped back to the source chunk it was
 * drawn from. Only ever populated when the provider's `supportsCitations` is
 * true — a provider without native citation support must return `[]`, never
 * a prompt-engineered imitation.
 */
export interface Citation {
  citedText: string;
  source: string; // provenance of the chunk the citation points at
  documentIndex: number;
}

export interface GenerationOutput {
  answer: string;
  citations: Citation[];
}

/**
 * The generation swap point (TDD §2.5, D4 update) — mirrors `EmbeddingProvider`
 * / `VectorStore` (TDD §2.1–2.2). Abstain-on-empty-retrieval (D5) is policy,
 * not mechanism, so it lives one layer up in `GenerationService`; a provider
 * only ever sees non-empty, already-filtered chunks and is asked to produce
 * one grounded answer from them — the same store-does-mechanism /
 * service-owns-policy split as retrieval's min-score floor.
 *
 * `supportsCitations` is a capability flag, not a preference. Claude's native
 * citations API returns verifiable spans mapped to source chunks; most other
 * providers (OpenAI-compatible endpoints, local models) have no equivalent,
 * so they report `false` and always return `citations: []`. Never
 * prompt-engineer a citation format as a substitute — that's exactly the
 * brittleness the original Claude-only decision (D4) rejected, and it would
 * be worse on a smaller model. Faking verifiability is a bigger trust
 * violation than admitting a provider doesn't have it.
 */
export interface GenerationProvider {
  /**
   * Stable, low-cardinality provider identity (`anthropic`, `openai-compatible`)
   * — used as the `provider` label on `rag_generation_duration_seconds` (RAG-63e)
   * and in logs. Never a model id or anything user-derived (would explode the
   * metric series).
   */
  readonly name: string;
  readonly supportsCitations: boolean;
  generate(question: string, chunks: RetrievedChunk[]): Promise<GenerationOutput>;
  /**
   * Explicit, user-initiated ungrounded answer from the model's own knowledge —
   * **not** drawn from the corpus and never cited. This is the *only* sanctioned
   * exception to the grounding guarantee (D5, `ai-and-secrets.md`): the default
   * `generate` path still abstains on empty retrieval, and this method is reached
   * solely through the opt-in `/query/general` route after the user has seen an
   * abstain and explicitly asked for general knowledge. The UI must label the
   * result as non-corpus. Returns plain text — no `Citation`s, because there is
   * no source to verify against (faking one here would be the same trust
   * violation `supportsCitations` exists to prevent).
   */
  generateGeneral(question: string): Promise<string>;
}

/** DI token for the configured GenerationProvider (selected by GENERATION_PROVIDER). */
export const GENERATION_PROVIDER = 'GENERATION_PROVIDER';
