import { Inject, Injectable, Logger } from '@nestjs/common';
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
  ) {}

  async generate(question: string): Promise<QueryResult> {
    const chunks = await this.retrieval.retrieve(question);

    // Abstain on empty retrieval — never free-generate (D5). Provider-agnostic.
    if (chunks.length === 0) {
      this.logger.log('abstaining: no chunks cleared the score floor');
      return {
        answer: ABSTAIN_MESSAGE,
        citations: [],
        chunks: [],
        abstained: true,
        citationsSupported: this.provider.supportsCitations,
      };
    }

    const { answer, citations } = await this.provider.generate(question, chunks);

    this.logger.log(
      `generated answer over ${chunks.length} chunks with ${citations.length} citations`,
    );
    return {
      answer,
      citations,
      chunks,
      abstained: false,
      citationsSupported: this.provider.supportsCitations,
    };
  }
}
