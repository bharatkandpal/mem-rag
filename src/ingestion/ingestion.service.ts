import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
} from '../embedding/embedding-provider.interface';
import { MetricsService } from '../observability/metrics.service';
import {
  ChunkInput,
  VECTOR_STORE,
  VectorStore,
} from '../vector-store/vector-store.interface';
import { chunk, ChunkOptions, DEFAULT_CHUNK_OPTIONS } from './chunker';
import { DocumentLoader } from './document-loader';

export interface IngestStats {
  docs: number;
  chunks: number;
  ms: number;
}

/**
 * The ingestion pipeline (RAG-16): load → chunk → embed → upsert. A thin
 * orchestrator — it depends only on the loader and the two adapter *interfaces*
 * (injected by token), so the embedding model and vector store are swappable
 * underneath it. Chunk sizing comes from config (CHUNK_TOKENS / OVERLAP_TOKENS).
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly chunkOptions: ChunkOptions;

  constructor(
    private readonly loader: DocumentLoader,
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
    @Inject(VECTOR_STORE) private readonly store: VectorStore,
    config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.chunkOptions = {
      chunkTokens: config.get<number>('CHUNK_TOKENS', DEFAULT_CHUNK_OPTIONS.chunkTokens),
      overlapTokens: config.get<number>('OVERLAP_TOKENS', DEFAULT_CHUNK_OPTIONS.overlapTokens),
    };
  }

  async ingest(path: string): Promise<IngestStats> {
    const started = Date.now();
    const docs = await this.loader.load(path);

    let totalChunks = 0;
    for (const doc of docs) {
      const chunks = chunk(doc.text, this.chunkOptions);
      if (chunks.length === 0) continue;

      // Batch-embed this doc's chunks, then persist with provenance.
      const embeddings = await this.embedder.embed(chunks.map((c) => c.content));
      const inputs: ChunkInput[] = chunks.map((c, i) => ({
        docId: doc.docId,
        source: doc.source,
        chunkIndex: c.chunkIndex,
        content: c.content,
        embedding: embeddings[i],
      }));
      await this.store.upsert(inputs);
      totalChunks += inputs.length;
    }

    const ms = Date.now() - started;
    this.logger.log(`ingested ${docs.length} docs, ${totalChunks} chunks in ${ms}ms`);
    this.metrics?.recordIngest(docs.length, totalChunks);
    return { docs: docs.length, chunks: totalChunks, ms };
  }
}
