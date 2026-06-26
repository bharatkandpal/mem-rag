/**
 * The embedding swap point (TDD §2.1). Ingestion and retrieval depend only on
 * this interface — never on a concrete provider — so the embedding model can be
 * swapped by changing one binding, with no churn at the call sites.
 */
export interface EmbeddingProvider {
  /**
   * Output dimensionality of this model's vectors. MUST match the schema's
   * `VECTOR(n)` column — a mismatch is a migration + re-ingest, not a drop-in
   * (the pgvector dims trap). Asserted against the DB at startup.
   */
  readonly dims: number;

  /**
   * Embed a batch of texts. Batch-first by design: embedding cost/latency is
   * dominated by request count, so callers should embed many chunks per call.
   * Returns one vector per input, in the same order.
   */
  embed(texts: string[]): Promise<number[][]>;
}

/** DI token for the configured EmbeddingProvider (selected by EMBEDDING_PROVIDER). */
export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';
