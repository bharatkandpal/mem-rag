import { DynamicModule, Module } from '@nestjs/common';
import { RAG_RETRIEVAL_OPTIONS, RagRetrievalOptions, RetrievalService } from './retrieval.service';

/**
 * Retrieval feature module (RAG-20-24). Exports RetrievalService for generation
 * to consume (RAG-27). The embedding provider and vector store come from their
 * @Global modules, injected by token. No controller — there's no public
 * /retrieve route; retrieval is reached through /query.
 */
@Module({
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {
  /**
   * Same module, with an explicit k / min-score override bound for
   * RetrievalService to pick up (RAG-66c, `RagModule.forRoot({ k, minScore })`).
   * Omitting `options` (or any field on it) falls back to env, identical to the
   * plain `RetrievalModule` import the standalone app uses.
   */
  static register(options?: RagRetrievalOptions): DynamicModule {
    return {
      module: RetrievalModule,
      providers: [
        RetrievalService,
        ...(options ? [{ provide: RAG_RETRIEVAL_OPTIONS, useValue: options }] : []),
      ],
      exports: [RetrievalService],
    };
  }
}
