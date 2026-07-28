import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
} from '../embedding/embedding-provider.interface';
import { MetricsService } from '../observability/metrics.service';
import {
  RetrievedChunk,
  VECTOR_STORE,
  VectorStore,
} from '../vector-store/vector-store.interface';

const DEFAULT_K = 5;
// Calibrated from measured score distributions (RAG-57, eval/probe-scores.ts):
// 0.3 abstains on most out-of-corpus queries while every labeled in-corpus
// question still clears it. Known residual: tech-adjacent junk can score ~0.35+.
const DEFAULT_MIN_SCORE = 0.3;

/**
 * Retrieval (RAG-20/23): embed the query, fetch cosine top-k from the store,
 * then drop anything below the min-score floor. The floor + k are policy and
 * live here (config-driven), keeping the store a pure top-k mechanism. Returning
 * [] when nothing clears the floor is what lets generation abstain (D5).
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly k: number;
  private readonly minScore: number;

  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly embedder: EmbeddingProvider,
    @Inject(VECTOR_STORE) private readonly store: VectorStore,
    config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.k = toNumber(config.get('RETRIEVAL_K'), DEFAULT_K);
    this.minScore = toNumber(config.get('MIN_SCORE'), DEFAULT_MIN_SCORE);
  }

  async retrieve(query: string): Promise<RetrievedChunk[]> {
    const started = Date.now();
    const [embedding] = await this.embedder.embed([query]);
    const hits = await this.store.search(embedding, this.k);
    // Top-hit score (pre-floor) — the distribution that informs floor tuning,
    // including the near-floor abstains a post-floor view would hide.
    if (hits.length > 0) this.metrics?.observeRetrievalScore(hits[0].score);
    const kept = hits.filter((h) => h.score >= this.minScore);
    this.logger.log(
      `retrieve: ${hits.length} hits, ${kept.length} above floor ${this.minScore} (k=${this.k}) in ${Date.now() - started}ms`,
    );
    return kept;
  }
}

/** Env values arrive as strings; coerce with a sane fallback (0 is a valid floor). */
function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
