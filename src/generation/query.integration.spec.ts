import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../database/database.module';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
} from '../embedding/embedding-provider.interface';
import {
  RetrievedChunk,
  VECTOR_STORE,
  VectorStore,
} from '../vector-store/vector-store.interface';
import {
  GENERATION_PROVIDER,
  GenerationProvider,
} from './generation-provider.interface';

/**
 * /query integration test (RAG-45): the real HTTP pipeline —
 * controller → GenerationService → RetrievalService — over the full DI graph,
 * with only the process-boundary adapters (embedder, store, model, pg pool)
 * replaced at their tokens. Exercises validation, the happy path, and the
 * abstain policy end-to-end.
 */
describe('POST /query (integration)', () => {
  let app: INestApplication;

  // Scores sit above any calibrated MIN_SCORE floor (Voyage 0.3, bge-large 0.59, …)
  // so this in-corpus case stays green regardless of the configured provider /
  // ambient .env MIN_SCORE; the abstain case below uses a score below every floor.
  const storedChunks: RetrievedChunk[] = [
    { content: 'pgvector stores embeddings in Postgres.', source: 'TDD.md', score: 0.92 },
    { content: 'HNSW is the index type.', source: 'TDD.md', score: 0.81 },
  ];

  const embedder: EmbeddingProvider = {
    dims: 4,
    embed: jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4])),
  };

  // Simulates the floor's effect: an "unknown" query gets low-score hits only.
  const store: VectorStore = {
    upsert: jest.fn(),
    search: jest.fn(async () => storedChunks),
  };

  const provider: GenerationProvider = {
    supportsCitations: true,
    generate: jest.fn(async (_q, chunks) => ({
      answer: 'Embeddings live in Postgres via pgvector.',
      citations: [
        { citedText: 'pgvector stores embeddings in Postgres.', source: chunks[0].source, documentIndex: 0 },
      ],
    })),
    generateGeneral: jest.fn(async () => 'Paris is the capital of France.'),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PG_POOL)
      .useValue({ query: jest.fn(), end: jest.fn() })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(embedder)
      .overrideProvider(VECTOR_STORE)
      .useValue(store)
      .overrideProvider(GENERATION_PROVIDER)
      .useValue(provider)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a cited answer with chunks for an in-corpus question', async () => {
    const res = await request(app.getHttpServer())
      .post('/query')
      .send({ question: 'Where are embeddings stored?' })
      .expect(201);

    expect(res.body.answer).toBe('Embeddings live in Postgres via pgvector.');
    expect(res.body.abstained).toBe(false);
    expect(res.body.citationsSupported).toBe(true);
    expect(res.body.citations).toHaveLength(1);
    expect(res.body.citations[0].source).toBe('TDD.md');
    expect(res.body.chunks).toHaveLength(2);
    expect(provider.generate).toHaveBeenCalledWith(
      'Where are embeddings stored?',
      storedChunks,
    );
  });

  it('abstains (never calls the provider) when nothing clears the floor', async () => {
    (store.search as jest.Mock).mockResolvedValueOnce([
      { content: 'noise', source: 'TDD.md', score: 0.05 },
    ]);
    (provider.generate as jest.Mock).mockClear();

    const res = await request(app.getHttpServer())
      .post('/query')
      .send({ question: 'What is the capital of France?' })
      .expect(201);

    expect(res.body.abstained).toBe(true);
    expect(res.body.citations).toEqual([]);
    expect(res.body.chunks).toEqual([]);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('rejects a missing or empty question with 400', async () => {
    await request(app.getHttpServer()).post('/query').send({}).expect(400);
    await request(app.getHttpServer())
      .post('/query')
      .send({ question: '   ' })
      .expect(400);
  });

  it('POST /query/general returns an ungrounded answer (no retrieval, grounded=false)', async () => {
    (store.search as jest.Mock).mockClear();

    const res = await request(app.getHttpServer())
      .post('/query/general')
      .send({ question: 'What is the capital of France?' })
      .expect(201);

    expect(res.body.answer).toBe('Paris is the capital of France.');
    expect(res.body.grounded).toBe(false);
    expect(res.body.abstained).toBe(false);
    expect(res.body.citations).toEqual([]);
    expect(res.body.chunks).toEqual([]);
    // the opt-in general path must bypass retrieval entirely
    expect(store.search).not.toHaveBeenCalled();
    expect(provider.generateGeneral).toHaveBeenCalledWith('What is the capital of France?');
  });

  it('POST /query/general rejects an empty question with 400', async () => {
    await request(app.getHttpServer()).post('/query/general').send({}).expect(400);
  });
});
