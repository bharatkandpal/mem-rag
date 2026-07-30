import { DynamicModule, Module } from '@nestjs/common';
import { DocumentLoader } from './document-loader';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

/**
 * Ingestion feature module (RAG-16/17; RAG-66c). `@Module()` deliberately omits
 * `controllers` — it lives only in `register()` below, alongside the `http`
 * toggle. Nest concatenates a class's static `@Module()` metadata with a
 * `DynamicModule`'s own `controllers` array rather than replacing it (see
 * `generation.module.ts` for the full explanation), so a decorator-level
 * `controllers: [IngestionController]` would always register the route
 * regardless of `register()`'s `http` flag. `register()` is the single source
 * of truth — used by both `AppModule` and `RagModule.forRoot()`.
 */
@Module({
  providers: [IngestionService, DocumentLoader],
  // Exported so RagModule (the embeddable surface, RAG-66) can re-export it to a host.
  exports: [IngestionService],
})
export class IngestionModule {
  /** Default `http: false` — a host embedding the services usually doesn't
   * want `POST /ingest` registered; `true` opts in (`RagModule.forRoot({ http: true })`). */
  static register(options: { http?: boolean } = {}): DynamicModule {
    return {
      module: IngestionModule,
      providers: [IngestionService, DocumentLoader],
      controllers: options.http ? [IngestionController] : [],
      exports: [IngestionService],
    };
  }
}
