import { PipelineLoader, TransformersEmbeddingProvider } from './transformers-embedding.provider';

/**
 * Unit tests for the local transformers.js adapter. The pipeline loader is the
 * boundary — we inject a fake so these run offline, deterministically, and
 * without loading the real runtime or downloading model weights. What we pin:
 * dims (schema contract), the empty-input shortcut, batch order/shape, the
 * pooling+normalize options, config-driven model, and single-load caching.
 */
describe('TransformersEmbeddingProvider', () => {
  // A fake extractor that echoes a fixed matrix; `loaderMock` records how it's called.
  const fakeLoader = (matrix: number[][]) => {
    const extractor: jest.Mock = jest.fn(async () => ({ tolist: () => matrix }));
    const loaderMock: jest.Mock = jest.fn(async () => extractor);
    return { extractor, loaderMock, loader: loaderMock as unknown as PipelineLoader };
  };

  it('reports 1024 dims (must match the VECTOR(1024) schema)', () => {
    const provider = new TransformersEmbeddingProvider();
    expect(provider.dims).toBe(1024);
  });

  it('returns [] for empty input without loading the model', async () => {
    const { loader, loaderMock } = fakeLoader([]);
    const provider = new TransformersEmbeddingProvider('m', loader);

    expect(await provider.embed([])).toEqual([]);
    expect(loaderMock).not.toHaveBeenCalled();
  });

  it('embeds a batch, returning one vector row per input in order', async () => {
    const { extractor, loader } = fakeLoader([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const provider = new TransformersEmbeddingProvider('m', loader);

    const out = await provider.embed(['a', 'b']);

    expect(out).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    // Cosine-ready contract: mean-pooled + normalized.
    expect(extractor).toHaveBeenCalledWith(['a', 'b'], { pooling: 'mean', normalize: true });
  });

  it('loads the model once and caches it across calls', async () => {
    const { loaderMock, loader } = fakeLoader([[0.1]]);
    const provider = new TransformersEmbeddingProvider('m', loader);

    await provider.embed(['a']);
    await provider.embed(['b']);

    expect(loaderMock).toHaveBeenCalledTimes(1);
  });

  it('passes the configured model to the loader', async () => {
    const { loaderMock, loader } = fakeLoader([[0.1]]);
    const provider = new TransformersEmbeddingProvider('Xenova/custom-model', loader);

    await provider.embed(['a']);

    expect(loaderMock).toHaveBeenCalledWith('Xenova/custom-model');
  });

  it('defaults to bge-large-en-v1.5 (a 1024-dim model) when none is given', async () => {
    const { loaderMock, loader } = fakeLoader([[0.1]]);
    const provider = new TransformersEmbeddingProvider(undefined, loader);

    await provider.embed(['a']);

    expect(loaderMock).toHaveBeenCalledWith('Xenova/bge-large-en-v1.5');
  });
});
