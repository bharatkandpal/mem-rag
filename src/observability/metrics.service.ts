import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Query outcomes (RAG-63e). `grounded` = a corpus answer; `abstained` = nothing
 * cleared the score floor (a success, not an error); `general` = the opt-in
 * ungrounded `/query/general` path. Kept a fixed enum so the `outcome` label
 * stays low-cardinality.
 */
export type QueryOutcome = 'grounded' | 'abstained' | 'general';

/**
 * Owns the Prometheus registry and metric instruments (RAG-63d/e). Uses a
 * dedicated `Registry` (not prom-client's global default) so instruments never
 * collide across app instances or test suites.
 *
 * `METRICS_ENABLED` (default true) gates both the `/metrics` route
 * (`MetricsController`) and process-metric collection. Process/GC/event-loop
 * collectors (which hold persistent handles) are started in `onModuleInit`, not
 * the constructor, so unit tests that `new MetricsService(...)` stay
 * handle-free.
 *
 * HTTP metrics are recorded by `HttpMetricsInterceptor`; the domain series are
 * recorded by the feature services (ingestion/retrieval/generation) through the
 * `record*` / `observe*` methods below, which inject this service `@Optional()`.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();
  readonly enabled: boolean;

  // HTTP (RAG-63d)
  readonly httpRequests: Counter<'route' | 'method' | 'status'>;
  readonly httpDuration: Histogram<'route'>;

  // Domain (RAG-63e)
  readonly ingestDocs: Counter;
  readonly ingestChunks: Counter;
  readonly retrievalScore: Histogram;
  readonly queryTotal: Counter<'outcome'>;
  readonly generationDuration: Histogram<'provider'>;
  readonly errors: Counter<'type'>;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('METRICS_ENABLED', 'true') !== 'false';

    this.httpRequests = new Counter({
      name: 'rag_http_requests_total',
      help: 'HTTP requests by route, method, and response status.',
      labelNames: ['route', 'method', 'status'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'rag_http_request_duration_seconds',
      help: 'HTTP request duration in seconds, by route.',
      labelNames: ['route'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.ingestDocs = new Counter({
      name: 'rag_ingest_docs_total',
      help: 'Documents ingested.',
      registers: [this.registry],
    });
    this.ingestChunks = new Counter({
      name: 'rag_ingest_chunks_total',
      help: 'Chunks embedded and upserted during ingestion.',
      registers: [this.registry],
    });
    this.retrievalScore = new Histogram({
      name: 'rag_retrieval_score',
      help: 'Top-hit cosine similarity per retrieval (feeds min-score floor tuning).',
      buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      registers: [this.registry],
    });
    this.queryTotal = new Counter({
      name: 'rag_query_total',
      help: 'Query outcomes (grounded | abstained | general).',
      labelNames: ['outcome'],
      registers: [this.registry],
    });
    this.generationDuration = new Histogram({
      name: 'rag_generation_duration_seconds',
      help: 'Provider generate() latency in seconds, by provider.',
      labelNames: ['provider'],
      buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
      registers: [this.registry],
    });
    this.errors = new Counter({
      name: 'rag_errors_total',
      help: 'Unhandled server faults (5xx) surfaced by the exception filter, by type. Abstain (200) and validation (4xx) are not errors.',
      labelNames: ['type'],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    // Default process/GC/event-loop metrics — only when enabled, on our registry.
    // Deferred out of the constructor because these collectors hold live handles.
    if (this.enabled) {
      collectDefaultMetrics({ register: this.registry });
    }
  }

  /** Ingestion throughput (RAG-63e). */
  recordIngest(docs: number, chunks: number): void {
    this.ingestDocs.inc(docs);
    this.ingestChunks.inc(chunks);
  }

  /** Top-hit similarity of a retrieval — the distribution behind floor tuning. */
  observeRetrievalScore(score: number): void {
    this.retrievalScore.observe(score);
  }

  /** One query outcome. `abstained` is a success here, never an error. */
  recordQuery(outcome: QueryOutcome): void {
    this.queryTotal.inc({ outcome });
  }

  /** Provider `generate()` latency, labelled by `GenerationProvider.name`. */
  observeGeneration(provider: string, seconds: number): void {
    this.generationDuration.observe({ provider }, seconds);
  }

  /** A surfaced server fault (5xx). `type` is the exception class — a fixed set. */
  recordError(type: string): void {
    this.errors.inc({ type });
  }

  /** Prometheus exposition text for `GET /metrics`. */
  render(): Promise<string> {
    return this.registry.metrics();
  }
}
