import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from '../embedding/embedding-provider.interface';
import { ChunkInput, VectorStore } from '../vector-store/vector-store.interface';
import { DocumentLoader, LoadedDocument } from './document-loader';
import { IngestionService } from './ingestion.service';

/**
 * Orchestration tests: the loader, embedder, and store are mocked; the real
 * chunker runs on tiny inputs. We assert the pipeline wires them together
 * correctly (right contents embedded, right ChunkInputs persisted, accurate
 * stats) and that empty docs are skipped.
 */
describe('IngestionService', () => {
  let loader: { load: jest.Mock };
  let embedder: EmbeddingProvider & { embed: jest.Mock };
  let store: VectorStore & { upsert: jest.Mock };
  let service: IngestionService;

  const config = { get: (_key: string, def: unknown) => def } as unknown as ConfigService;

  beforeEach(() => {
    loader = { load: jest.fn() };
    // Echo one vector per input so any chunk count works.
    embedder = { dims: 1024, embed: jest.fn(async (t: string[]) => t.map(() => [0.1])) };
    store = { upsert: jest.fn(async (c: ChunkInput[]) => c.length), search: jest.fn() };
    service = new IngestionService(
      loader as unknown as DocumentLoader,
      embedder,
      store,
      config,
    );
  });

  const doc = (over: Partial<LoadedDocument> = {}): LoadedDocument => ({
    docId: 'a.md',
    source: 'a.md',
    text: 'A short document.',
    ...over,
  });

  it('runs load → chunk → embed → upsert and returns stats', async () => {
    loader.load.mockResolvedValue([doc()]);

    const stats = await service.ingest('corpus/');

    expect(loader.load).toHaveBeenCalledWith('corpus/');
    expect(embedder.embed).toHaveBeenCalledWith(['A short document.']);
    const upserted = store.upsert.mock.calls[0][0] as ChunkInput[];
    expect(upserted).toEqual([
      { docId: 'a.md', source: 'a.md', chunkIndex: 0, content: 'A short document.', embedding: [0.1] },
    ]);
    expect(stats).toEqual({ docs: 1, chunks: 1, ms: expect.any(Number) });
  });

  it('skips documents that produce no chunks', async () => {
    loader.load.mockResolvedValue([doc({ text: '   \n\n  ' })]);

    const stats = await service.ingest('corpus/');

    expect(embedder.embed).not.toHaveBeenCalled();
    expect(store.upsert).not.toHaveBeenCalled();
    expect(stats.chunks).toBe(0);
    expect(stats.docs).toBe(1);
  });

  it('aggregates chunk counts across multiple documents', async () => {
    loader.load.mockResolvedValue([doc({ docId: 'a.md' }), doc({ docId: 'b.md' })]);

    const stats = await service.ingest('corpus/');

    expect(stats.docs).toBe(2);
    expect(stats.chunks).toBe(2);
    expect(store.upsert).toHaveBeenCalledTimes(2);
  });
});
