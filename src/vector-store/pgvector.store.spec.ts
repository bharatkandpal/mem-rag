import { Pool } from 'pg';
import { ChunkInput } from './vector-store.interface';
import { PgVectorStore } from './pgvector.store';

/**
 * Unit tests for the pgvector upsert SQL builder. The pool is mocked — we assert
 * the generated SQL and bound params without a database. What matters: idempotent
 * upsert (ON CONFLICT), correct param order, the pgvector text encoding of the
 * embedding, and the empty-input shortcut.
 */
describe('PgVectorStore.upsert', () => {
  let queryMock: jest.Mock;
  let store: PgVectorStore;

  const chunk = (overrides: Partial<ChunkInput> = {}): ChunkInput => ({
    docId: 'doc-1',
    source: 'a.md',
    chunkIndex: 0,
    content: 'hello',
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  });

  beforeEach(() => {
    queryMock = jest.fn().mockResolvedValue({ rowCount: 1 });
    store = new PgVectorStore({ query: queryMock } as unknown as Pool);
  });

  it('returns 0 and does not touch the DB on empty input', async () => {
    expect(await store.upsert([])).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('upserts idempotently via ON CONFLICT on (doc_id, chunk_index)', async () => {
    await store.upsert([chunk()]);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(doc_id, chunk_index\)/);
    expect(sql).toMatch(/DO UPDATE SET/);
  });

  it('binds params in column order and encodes the embedding for pgvector', async () => {
    await store.upsert([chunk()]);
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(['doc-1', 'a.md', 0, 'hello', '[0.1,0.2,0.3]']);
  });

  it('builds one value tuple per chunk with offset placeholders', async () => {
    await store.upsert([chunk({ chunkIndex: 0 }), chunk({ chunkIndex: 1 })]);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('($1, $2, $3, $4, $5::vector)');
    expect(sql).toContain('($6, $7, $8, $9, $10::vector)');
    expect(params).toHaveLength(10);
  });

  it('returns the number of rows written', async () => {
    queryMock.mockResolvedValue({ rowCount: 2 });
    expect(await store.upsert([chunk(), chunk({ chunkIndex: 1 })])).toBe(2);
  });
});

describe('PgVectorStore.search', () => {
  let queryMock: jest.Mock;
  let store: PgVectorStore;

  beforeEach(() => {
    queryMock = jest.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ content: 'hit', source: 'a.md', score: '0.91' }],
    });
    store = new PgVectorStore({ query: queryMock } as unknown as Pool);
  });

  it('orders by cosine distance and limits to k', async () => {
    await store.search([0.1, 0.2], 3);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/embedding <=> \$1::vector/);
    expect(sql).toMatch(/ORDER BY embedding <=> \$1::vector/);
    expect(sql).toMatch(/LIMIT \$2/);
    expect(params).toEqual(['[0.1,0.2]', 3]);
  });

  it('returns similarity (1 - distance) as a number', async () => {
    const hits = await store.search([0.1], 5);
    expect(hits).toEqual([{ content: 'hit', source: 'a.md', score: 0.91 }]);
    expect(typeof hits[0].score).toBe('number');
  });
});
