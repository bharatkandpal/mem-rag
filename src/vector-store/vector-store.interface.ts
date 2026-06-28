/**
 * The vector-store swap point (TDD §2.2). Ingestion and retrieval depend on this
 * interface, never on pgvector directly, so the store can be swapped (Qdrant,
 * Pinecone, …) without touching call sites — the same seam discipline as the
 * embedding adapter.
 */
export interface VectorStore {
  /**
   * Insert or update chunks, keyed on (doc_id, chunk_index). Idempotent:
   * re-ingesting the same document updates rows in place rather than
   * duplicating them. Returns the number of rows written.
   */
  upsert(chunks: ChunkInput[]): Promise<number>;

  /**
   * Cosine top-k nearest neighbours to the query embedding (RAG-21). Pure
   * mechanism: returns the k closest chunks with their similarity score. The
   * min-score floor and abstain policy live in the retrieval service, not here.
   */
  search(embedding: number[], k: number): Promise<RetrievedChunk[]>;
}

/** A chunk ready to persist: its text plus the embedding vector and provenance. */
export interface ChunkInput {
  docId: string;
  source: string; // filename / URL the chunk came from
  chunkIndex: number;
  content: string;
  embedding: number[];
}

/** A retrieval hit: the chunk's text, its provenance, and cosine similarity (higher = closer). */
export interface RetrievedChunk {
  content: string;
  source: string;
  score: number;
}

/** DI token for the configured VectorStore. */
export const VECTOR_STORE = 'VECTOR_STORE';
