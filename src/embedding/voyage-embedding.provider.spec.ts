import { VoyageEmbeddingProvider } from './voyage-embedding.provider';

/**
 * Unit tests for the Voyage adapter. `fetch` is the network boundary — we mock
 * it so these run offline, deterministically, and without an API key or cost.
 * What we pin down: input-order preservation, the empty-input shortcut, request
 * shape, and that failures surface without leaking the key.
 */
describe('VoyageEmbeddingProvider', () => {
  const KEY = 'test-key';
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  const okResponse = (data: { index: number; embedding: number[] }[]) => ({
    ok: true,
    json: async () => ({ data, usage: { total_tokens: 42 } }),
  });

  it('reports 1024 dims (must match the VECTOR(1024) schema)', () => {
    const provider = new VoyageEmbeddingProvider(KEY);
    expect(provider.dims).toBe(1024);
  });

  it('throws if constructed without an API key', () => {
    expect(() => new VoyageEmbeddingProvider('')).toThrow(/VOYAGE_API_KEY/);
  });

  it('returns [] for empty input without calling the network', async () => {
    const provider = new VoyageEmbeddingProvider(KEY);
    const out = await provider.embed([]);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves input order even when the API returns vectors out of order', async () => {
    // API responds with index 1 before index 0 — the adapter must re-sort.
    fetchMock.mockResolvedValue(
      okResponse([
        { index: 1, embedding: [0.2] },
        { index: 0, embedding: [0.1] },
      ]),
    );
    const provider = new VoyageEmbeddingProvider(KEY);
    const out = await provider.embed(['first', 'second']);
    expect(out).toEqual([[0.1], [0.2]]);
  });

  it('sends the model, batched input, and bearer auth', async () => {
    fetchMock.mockResolvedValue(okResponse([{ index: 0, embedding: [0.1] }]));
    const provider = new VoyageEmbeddingProvider(KEY);
    await provider.embed(['hello']);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toEqual({ input: ['hello'], model: 'voyage-3' });
  });

  it('throws on a non-ok response without leaking the key', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    const provider = new VoyageEmbeddingProvider(KEY);
    await expect(provider.embed(['x'])).rejects.toThrow(/401/);
    await expect(provider.embed(['x'])).rejects.not.toThrow(new RegExp(KEY));
  });
});
