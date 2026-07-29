import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { GenerationModule } from './generation/generation.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { VectorStoreModule } from './vector-store/vector-store.module';

/**
 * The embeddable entry point (GO-21j / RAG-66). A host NestJS app adds a single
 * import — `RagModule.forRoot()` — and gets the whole pipeline: ingestion,
 * retrieval, and cited generation, wired from the same @Global embedding /
 * vector-store seams the standalone app uses. It **composes the existing
 * feature modules and re-exports the three services; it re-implements nothing**
 * — one pipeline, now reachable three ways (HTTP, CLI, embedded library).
 *
 * Env-first: with the same env the app reads (`EMBEDDING_PROVIDER`,
 * `GENERATION_PROVIDER`, `RETRIEVAL_K`, `MIN_SCORE`, `DATABASE_URL`, keys),
 * `forRoot()` reproduces the app's behavior exactly. The typed override surface
 * (an `http` controller toggle, `k` / `minScore`, provider selection) lands in
 * RAG-66c; today the seam is env only.
 *
 * `ConfigModule.forRoot({ isGlobal: true })` is included so the module boots the
 * full graph on its own (the services inject `ConfigService`). A host that has
 * already called `ConfigModule.forRoot` keeps its own config; @nestjs/config
 * tolerates the re-registration and both read the same `process.env`.
 */
@Module({})
export class RagModule {
  static forRoot(): DynamicModule {
    return {
      module: RagModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        EmbeddingModule,
        VectorStoreModule,
        IngestionModule,
        RetrievalModule,
        GenerationModule,
      ],
      // Re-export the feature modules so the host can inject the services they
      // expose (IngestionService / RetrievalService / GenerationService).
      exports: [IngestionModule, RetrievalModule, GenerationModule],
    };
  }
}
