import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { GenerationModule } from './generation/generation.module';
import { HealthModule } from './health/health.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { ObservabilityModule } from './observability/observability.module';
import { VectorStoreModule } from './vector-store/vector-store.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityModule,
    DatabaseModule,
    EmbeddingModule,
    VectorStoreModule,
    // .register({ http: true }) — the only way IngestionModule/GenerationModule
    // are wired (RAG-66c; see generation.module.ts for why a bare import can't
    // coexist with the register()-based override surface RagModule also uses).
    IngestionModule.register({ http: true }),
    GenerationModule.register({ http: true }),
    HealthModule,
  ],
})
export class AppModule {}
