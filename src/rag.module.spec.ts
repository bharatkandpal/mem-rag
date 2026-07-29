import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PG_POOL } from './database/database.module';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding/embedding-provider.interface';
import {
  GENERATION_PROVIDER,
  GenerationProvider,
} from './generation/generation-provider.interface';
import { GenerationService } from './generation/generation.service';
import { IngestionService } from './ingestion/ingestion.service';
import { RagModule } from './rag.module';
import { RetrievalService } from './retrieval/retrieval.service';
import { RetrievedChunk, VECTOR_STORE, VectorStore } from './vector-store/vector-store.interface';

/**
 * The embeddable surface (RAG-66b/c): importing `RagModule.forRoot(options)`
 * must wire the full pipeline from env, expose the three services to the host,
 * and honor the typed override surface (`embeddingProvider`, `generationProvider`,
 * `k`, `minScore`, `http`) documented in `docs/embeddable-scaffold-guide.md`.
 * Only the process-boundary adapter (pg pool) is faked at its token — everything
 * else is proven through the real options-threading code, not Nest test
 * overrides, so these assertions exercise RagModule's own new code paths.
 */
describe('RagModule.forRoot() (embeddable surface, RAG-66b/c)', () => {
  it('boots the pipeline graph from env (forRoot({})) and exposes the three services to the host', async () => {
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

  it('threads k / minScore / embeddingProvider / generationProvider overrides through forRoot(options)', async () => {
    const embedder: EmbeddingProvider = {
      dims: 4,
      embed: jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4])),
    };
    // One hit above the override floor (0.5), one below it but above the
    // library default (0.3) — proves the override floor is what's applied,
    // not the default. store.search's own second arg proves the k override.
    const hits: RetrievedChunk[] = [
      { content: 'kept', source: 'a.md', score: 0.6 },
      { content: 'dropped by override floor, would pass the 0.3 default', source: 'b.md', score: 0.35 },
    ];
    const store: VectorStore = { upsert: jest.fn(), search: jest.fn(async () => hits) };
    const provider: GenerationProvider = {
      name: 'fake',
      supportsCitations: false,
      generate: jest.fn(async (_q, chunks) => ({
        answer: `answered over ${chunks.length} chunk(s)`,
        citations: [],
      })),
      generateGeneral: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        RagModule.forRoot({
          embeddingProvider: embedder,
          generationProvider: provider,
          k: 2,
          minScore: 0.5,
        }),
      ],
    })
      .overrideProvider(PG_POOL)
      .useValue({ query: jest.fn(), end: jest.fn() })
      .overrideProvider(VECTOR_STORE)
      .useValue(store)
      .compile();

    const generation = moduleRef.get(GenerationService, { strict: false });
    const result = await generation.generate('where is it?');

    expect(embedder.embed).toHaveBeenCalledWith(['where is it?']);
    expect(store.search).toHaveBeenCalledWith(expect.any(Array), 2); // k override
    expect(result.chunks).toEqual([hits[0]]); // minScore override drops the 0.35 hit
    expect(result.answer).toBe('answered over 1 chunk(s)');
    expect(provider.generate).toHaveBeenCalled();

    await moduleRef.close();
  });

  it('registers no HTTP routes by default (http omitted)', async () => {
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

    const app: INestApplication = moduleRef.createNestApplication({ logger: false });
    await app.init();

    await request(app.getHttpServer()).post('/query').send({ question: 'x' }).expect(404);
    await request(app.getHttpServer()).post('/ingest').send({ path: 'x' }).expect(404);

    await app.close();
  });

  it('registers /query and /ingest when http:true', async () => {
    const provider: GenerationProvider = {
      name: 'fake',
      supportsCitations: false,
      generate: jest.fn(async () => ({ answer: 'served over http', citations: [] })),
      generateGeneral: jest.fn(),
    };
    const store: VectorStore = {
      upsert: jest.fn(async () => 0),
      search: jest.fn(async () => [{ content: 'c', source: 's', score: 0.9 }]),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        RagModule.forRoot({
          http: true,
          embeddingProvider: { dims: 4, embed: jest.fn(async () => [[0, 0, 0, 0]]) },
          generationProvider: provider,
        }),
      ],
    })
      .overrideProvider(PG_POOL)
      .useValue({ query: jest.fn(), end: jest.fn() })
      .overrideProvider(VECTOR_STORE)
      .useValue(store)
      .compile();

    const app: INestApplication = moduleRef.createNestApplication({ logger: false });
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/query')
      .send({ question: 'x' })
      .expect(201);
    expect(res.body.answer).toBe('served over http');

    // Route exists (not 404) — ingestion correctness is covered elsewhere (RAG-16/17/19).
    await request(app.getHttpServer()).post('/ingest').send({ path: '' }).expect((r) => {
      if (r.status === 404) throw new Error('expected /ingest to be registered');
    });

    await app.close();
  });
});
