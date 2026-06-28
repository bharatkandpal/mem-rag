import { Module } from '@nestjs/common';
import { DocumentLoader } from './document-loader';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

/**
 * Ingestion feature module (RAG-16/17). The embedding provider and vector store
 * come from their @Global modules, so they're injected by token without import.
 */
@Module({
  providers: [IngestionService, DocumentLoader],
  controllers: [IngestionController],
})
export class IngestionModule {}
