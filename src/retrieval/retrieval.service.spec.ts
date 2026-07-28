import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from '../embedding/embedding-provider.interface';
import { MetricsService } from '../observability/metrics.service';
import { RetrievedChunk, VectorStore } from '../vector-store/vector-store.interface';
import { RetrievalService } from './retrieval.service';

/**
 * Retrieval policy tests: embedder + store mocked. We assert the query is
 * embedded, the store is searched with the configured k, and the min-score
 * floor is applied (which is what enables abstain).
 */
describe('RetrievalService', () => {
  let embedder: EmbeddingProvider & { embed: jest.Mock };
  let store: VectorStore & { search: jest.Mock };
  let metrics: { observeRetrievalScore: jest.Mock };

  const hit = (score: number, source = 's'): RetrievedChunk => ({
    content: `c-${score}`,
    source,
    score,
  });

  const build = (env: Record<string, string> = {}) => {
    embedder = { dims: 1024, embed: jest.fn(async () => [[0.5, 0.5]]) };
    store = { upsert: jest.fn(), search: jest.fn() };
    metrics = { observeRetrievalScore: jest.fn() };
    const config = { get: (k: string) => env[k] } as unknown as ConfigService;
    return new RetrievalService(embedder, store, config, metrics as unknown as MetricsService);
  };

  it('embeds the query and searches with the default k', async () => {
    const service = build();
    store.search.mockResolvedValue([]);

    await service.retrieve('what is x?');

    expect(embedder.embed).toHaveBeenCalledWith(['what is x?']);
    expect(store.search).toHaveBeenCalledWith([0.5, 0.5], 5);
  });

  it('honours RETRIEVAL_K and MIN_SCORE from config', async () => {
    const service = build({ RETRIEVAL_K: '3', MIN_SCORE: '0.5' });
    store.search.mockResolvedValue([hit(0.9), hit(0.6), hit(0.4)]);

    const out = await service.retrieve('q');

    expect(store.search).toHaveBeenCalledWith([0.5, 0.5], 3);
    // 0.4 is below the 0.5 floor → dropped.
    expect(out.map((h) => h.score)).toEqual([0.9, 0.6]);
  });

  it('returns [] when nothing clears the floor (enables abstain)', async () => {
    const service = build({ MIN_SCORE: '0.8' });
    store.search.mockResolvedValue([hit(0.5), hit(0.3)]);

    expect(await service.retrieve('q')).toEqual([]);
  });

  it('observes the top-hit score (pre-floor) to metrics, even when it abstains (RAG-63e)', async () => {
    const service = build({ MIN_SCORE: '0.8' });
    store.search.mockResolvedValue([hit(0.5), hit(0.3)]);

    await service.retrieve('q');

    // Top raw hit is observed regardless of the floor — that's the tuning signal.
    expect(metrics.observeRetrievalScore).toHaveBeenCalledWith(0.5);
  });

  it('does not observe a score when there are no hits', async () => {
    const service = build();
    store.search.mockResolvedValue([]);

    await service.retrieve('q');

    expect(metrics.observeRetrievalScore).not.toHaveBeenCalled();
  });
});
