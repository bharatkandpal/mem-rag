import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from '../observability/metrics.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { Citation, GENERATION_PROVIDER, GenerationProvider } from './generation-provider.interface';

const ABSTAIN_MESSAGE = "I don't have that information in the corpus.";

export interface QueryResult {
  answer: string;
  citations: Citation[];
  chunks: RetrievedChunk[];
  abstained: boolean;
  /** Whether the configured provider can verify citations (D4 update) — false for non-citation providers, never faked. */
  citationsSupported: boolean;
  /**
   * True for corpus-grounded answers (the product's default). False for the
   * explicit opt-in general-knowledge answer served by `generateGeneral` — the
   * UI colour-codes that as non-corpus. Abstentions are neither grounded nor an
   * answer, so they report `false` too.
   */
  grounded: boolean;
}

/**
 * Generation orchestration (RAG-25-30, D4). Retrieves, then delegates to the
 * configured GenerationProvider for the model call. Mirrors the
 * store-does-mechanism / service-owns-policy split from retrieval (TDD §2.4):
 * abstain-on-empty (D5) is policy and lives here, once, regardless of which
 * provider is configured — a provider never sees an empty chunk list.
 */
@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    @Inject(GENERATION_PROVIDER) private readonly provider: GenerationProvider,
    private readonly retrieval: RetrievalService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async generate(question: string): Promise<QueryResult> {
    const started = Date.now();
    const chunks = await this.retrieval.retrieve(question);

    // Abstain on empty retrieval — never free-generate (D5). Provider-agnostic.
    if (chunks.length === 0) {
      this.logger.log('abstaining: no chunks cleared the score floor');
      this.metrics?.recordQuery('abstained');
      return {
        answer: ABSTAIN_MESSAGE,
        citations: [],
        chunks: [],
        abstained: true,
        citationsSupported: this.provider.supportsCitations,
        grounded: false,
      };
    }

    const genStarted = Date.now();
    const { answer, citations } = await this.provider.generate(question, chunks);
    this.metrics?.observeGeneration(this.provider.name, (Date.now() - genStarted) / 1000);
    this.metrics?.recordQuery('grounded');

    this.logger.log(
      `generated answer over ${chunks.length} chunks with ${citations.length} citations in ${Date.now() - started}ms`,
    );
    return {
      answer,
      citations,
      chunks,
      abstained: false,
      citationsSupported: this.provider.supportsCitations,
      grounded: true,
    };
  }

  /**
   * Explicit, opt-in general-knowledge answer (NOT from the corpus). Reached
   * only via `POST /query/general` after the default `generate` has already
   * abstained and the user has asked for it. Deliberately bypasses retrieval
   * and grounding — `grounded: false`, no citations, no chunks — so the caller
   * (and UI) must present it as non-corpus. The abstain-on-empty guarantee of
   * the default path (D5) is untouched; this is the sanctioned exception, made
   * visible rather than silent.
   */
  async generateGeneral(question: string): Promise<QueryResult> {
    const genStarted = Date.now();
    const answer = await this.provider.generateGeneral(question);
    this.metrics?.observeGeneration(this.provider.name, (Date.now() - genStarted) / 1000);
    this.metrics?.recordQuery('general');
    this.logger.log('served explicit ungrounded general-knowledge answer (opt-in, not from corpus)');
    return {
      answer,
      citations: [],
      chunks: [],
      abstained: false,
      citationsSupported: this.provider.supportsCitations,
      grounded: false,
    };
  }
}
