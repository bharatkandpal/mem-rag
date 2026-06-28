import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import {
  ChunkInput,
  RetrievedChunk,
  VectorStore,
} from './vector-store.interface';

const COLS_PER_ROW = 5; // doc_id, source, chunk_index, content, embedding

/**
 * Postgres + pgvector implementation of VectorStore (TDD §2.2). All pgvector /
 * SQL specifics are contained here; nothing outside knows the storage engine.
 */
export class PgVectorStore implements VectorStore {
  private readonly logger = new Logger(PgVectorStore.name);

  constructor(private readonly pool: Pool) {}

  async upsert(chunks: ChunkInput[]): Promise<number> {
    if (chunks.length === 0) return 0;

    const started = Date.now();
    const values: unknown[] = [];
    const tuples = chunks.map((c, i) => {
      const b = i * COLS_PER_ROW;
      // pgvector accepts the text form '[1,2,3]' cast to ::vector.
      values.push(c.docId, c.source, c.chunkIndex, c.content, `[${c.embedding.join(',')}]`);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::vector)`;
    });

    // ON CONFLICT on the (doc_id, chunk_index) UNIQUE key makes re-ingest
    // idempotent: the same chunk updates in place instead of duplicating.
    const sql = `
      INSERT INTO chunks (doc_id, source, chunk_index, content, embedding)
      VALUES ${tuples.join(', ')}
      ON CONFLICT (doc_id, chunk_index)
      DO UPDATE SET source = EXCLUDED.source,
                    content = EXCLUDED.content,
                    embedding = EXCLUDED.embedding`;

    const res = await this.pool.query(sql, values);
    const written = res.rowCount ?? 0;
    this.logger.log(`upserted ${written} chunks in ${Date.now() - started}ms`);
    return written;
  }

  async search(embedding: number[], k: number): Promise<RetrievedChunk[]> {
    const started = Date.now();
    const vec = `[${embedding.join(',')}]`;
    // `<=>` is pgvector cosine *distance* (0 = identical). Similarity = 1 - distance.
    // Ordering by the distance lets the HNSW index serve the top-k.
    const sql = `
      SELECT content, source, 1 - (embedding <=> $1::vector) AS score
      FROM chunks
      ORDER BY embedding <=> $1::vector
      LIMIT $2`;
    const res = await this.pool.query(sql, [vec, k]);
    this.logger.log(`search returned ${res.rowCount ?? 0} hits (k=${k}) in ${Date.now() - started}ms`);
    return res.rows.map((r) => ({
      content: r.content as string,
      source: r.source as string,
      score: Number(r.score), // pg returns numeric expressions as strings
    }));
  }
}
