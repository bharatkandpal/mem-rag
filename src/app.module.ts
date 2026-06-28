import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { GenerationModule } from './generation/generation.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { VectorStoreModule } from './vector-store/vector-store.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    EmbeddingModule,
    VectorStoreModule,
    IngestionModule,
    RetrievalModule,
    GenerationModule,
    HealthModule,
  ],
})
export class AppModule {}
