import { Module } from '@nestjs/common';
import { RetrievalService } from './retrieval.service';

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
export class RetrievalModule {}
