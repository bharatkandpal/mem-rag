import { Test } from '@nestjs/testing';
import { PG_POOL } from './database/database.module';
import { EMBEDDING_PROVIDER } from './embedding/embedding-provider.interface';
import { GENERATION_PROVIDER } from './generation/generation-provider.interface';
import { GenerationService } from './generation/generation.service';
import { IngestionService } from './ingestion/ingestion.service';
import { RagModule } from './rag.module';
import { RetrievalService } from './retrieval/retrieval.service';
import { VECTOR_STORE } from './vector-store/vector-store.interface';

/**
 * The embeddable surface (RAG-66b): importing `RagModule.forRoot()` must wire
 * the full pipeline from env and expose the three services to the host —
 * proving the module composes the real DI graph, not a re-implementation. Only
 * the process-boundary adapters (pg pool, embedder, store, model) are replaced
 * at their tokens, exactly as a host with its own Postgres/providers would swap
 * them — the graph itself is the app's.
 */
describe('RagModule.forRoot() (embeddable surface, RAG-66b)', () => {
  it('boots the pipeline graph from env and exposes the three services to the host', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RagModule.forRoot()],
    })
      .overrideProvider(PG_POOL)
      .useValue({ query: jest.fn(), end: jest.fn() })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ dims: 4, embed: jest.fn() })
      .overrideProvider(VECTOR_STORE)
      .useValue({ upsert: jest.fn(), search: jest.fn() })
      .overrideProvider(GENERATION_PROVIDER)
      .useValue({
        name: 'test',
        supportsCitations: false,
        generate: jest.fn(),
        generateGeneral: jest.fn(),
      })
      .compile();

    // Resolvable from the host's perspective (strict:false = search the graph,
    // not just RagModule's own providers) → the re-exports are wired.
    expect(moduleRef.get(IngestionService, { strict: false })).toBeInstanceOf(
      IngestionService,
    );
    expect(moduleRef.get(RetrievalService, { strict: false })).toBeInstanceOf(
      RetrievalService,
    );
    expect(moduleRef.get(GenerationService, { strict: false })).toBeInstanceOf(
      GenerationService,
    );

    await moduleRef.close();
  });
});
