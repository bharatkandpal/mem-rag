import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { EmbeddingModule, EmbeddingProviderName } from './embedding/embedding.module';
import { EmbeddingProvider } from './embedding/embedding-provider.interface';
import { GenerationModule, GenerationProviderName } from './generation/generation.module';
import { GenerationProvider } from './generation/generation-provider.interface';
import { IngestionModule } from './ingestion/ingestion.module';
import { VectorStoreModule } from './vector-store/vector-store.module';

/**
 * `RagModule.forRoot()` options (RAG-66c). Every field is optional and
 * env-first: an omitted field falls back to exactly what the standalone app
 * reads from env today (`EMBEDDING_PROVIDER`, `GENERATION_PROVIDER`,
 * `RETRIEVAL_K`, `MIN_SCORE`). `forRoot({})` reproduces the app's behavior
 * with no surprises; each field is an explicit, independent override.
 */
export interface RagModuleOptions {
  /** Provider name (picks the built-in impl) or a concrete instance a host supplies. */
  embeddingProvider?: EmbeddingProviderName | EmbeddingProvider;
  /** Provider name (picks the built-in impl) or a concrete instance a host supplies. */
  generationProvider?: GenerationProviderName | GenerationProvider;
  /** Overrides `RETRIEVAL_K`. */
  k?: number;
  /** Overrides `MIN_SCORE`. */
  minScore?: number;
  /** Register `POST /ingest`, `/query`, `/query/general`? Default `false` — a
   * host embedding the services usually calls them in-process, not over HTTP;
   * `true` registers the same controllers the standalone app exposes. */
  http?: boolean;
}

/**
 * The embeddable entry point (GO-21j / RAG-66). A host NestJS app adds a single
 * import — `RagModule.forRoot(options)` — and gets the whole pipeline: ingestion,
 * retrieval, and cited generation, wired from the same seams the standalone app
 * uses. It **composes the existing feature modules and re-exports the three
 * services; it re-implements nothing** — one pipeline, now reachable three ways
 * (HTTP, CLI, embedded library).
 *
 * Env-first, optional overrides (RAG-66c): `forRoot({})` with the app's env set
 * reproduces the app's behavior exactly. `embeddingProvider` / `generationProvider`
 * / `k` / `minScore` slot into the existing DI seams (`EMBEDDING_PROVIDER`,
 * `GENERATION_PROVIDER`, `RAG_RETRIEVAL_OPTIONS`) via each feature module's own
 * `register()` — no new seam invented.
 *
 * `ConfigModule.forRoot({ isGlobal: true })` is included so the module boots the
 * full graph on its own (the services inject `ConfigService`). A host that has
 * already called `ConfigModule.forRoot` keeps its own config; @nestjs/config
 * tolerates the re-registration and both read the same `process.env`.
 */
@Module({})
export class RagModule {
  static forRoot(options: RagModuleOptions = {}): DynamicModule {
    const http = options.http ?? false;
    // Captured once, exported by these same object references (not the bare
    // classes) — see generation.module.ts for why: exporting a bare class can
    // resolve against a *different* module instance than the one actually
    // imported, silently dropping whatever options.register() was given.
    const ingestionModule = IngestionModule.register({ http });
    // GenerationModule.register() builds the single RetrievalModule instance
    // for this graph (via its own `retrieval` option) and re-exports it, so
    // RagModule reaches RetrievalService through GenerationModule rather
    // than importing RetrievalModule a second time — one instance, not two.
    const generationModule = GenerationModule.register({
      generationProvider: options.generationProvider,
      http,
      retrieval: { k: options.k, minScore: options.minScore },
    });
    return {
      module: RagModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        EmbeddingModule.register(options.embeddingProvider),
        VectorStoreModule,
        ingestionModule,
        generationModule,
      ],
      // GenerationModule re-exports RetrievalModule, so RetrievalService is
      // reachable transitively — the host can inject any of the three services.
      exports: [ingestionModule, generationModule],
    };
  }
}
