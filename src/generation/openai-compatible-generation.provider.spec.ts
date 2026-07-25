import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { OpenAICompatibleGenerationProvider } from './openai-compatible-generation.provider';

/**
 * `fetch` is the network boundary — mocked so these run offline. What we pin
 * down: the citations-never-faked contract (always []), request shape
 * (system + inlined context, not document blocks), and key-leak safety.
 */
describe('OpenAICompatibleGenerationProvider', () => {
  const KEY = 'test-key';
  let fetchMock: jest.Mock;

  const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
    content: 'The sky is blue.',
    source: 'facts.md',
    score: 0.9,
    ...over,
  });

  const okResponse = (content: string) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports supportsCitations = false', () => {
    const provider = new OpenAICompatibleGenerationProvider(
      'http://localhost:11434/v1',
      'llama3.2:1b',
    );
    expect(provider.supportsCitations).toBe(false);
  });

  it('throws if constructed without a base URL or model', () => {
    expect(() => new OpenAICompatibleGenerationProvider('', 'model')).toThrow(
      /GENERATION_BASE_URL/,
    );
    expect(() => new OpenAICompatibleGenerationProvider('http://x', '')).toThrow(
      /GENERATION_MODEL/,
    );
  });

  it('sends the model, system + inlined-context messages, and bearer auth when a key is set', async () => {
    fetchMock.mockResolvedValue(okResponse('Blue.'));
    const provider = new OpenAICompatibleGenerationProvider(
      'http://localhost:11434/v1',
      'llama3.2:1b',
      KEY,
    );

    await provider.generate('why?', [chunk({ source: 'a.md' })]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body);
    expect(body.model).toBe('llama3.2:1b');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toContain('a.md');
    expect(body.messages[1].content).toContain('why?');
  });

  it('omits the Authorization header when no key is configured (local servers)', async () => {
    fetchMock.mockResolvedValue(okResponse('ok'));
    const provider = new OpenAICompatibleGenerationProvider(
      'http://localhost:11434/v1',
      'llama3.2:1b',
    );
    await provider.generate('q', [chunk()]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('always returns an empty citations array — never fabricated', async () => {
    fetchMock.mockResolvedValue(okResponse('ok'));
    const provider = new OpenAICompatibleGenerationProvider('http://localhost:11434/v1', 'model');
    const result = await provider.generate('q', [chunk()]);
    expect(result.citations).toEqual([]);
    expect(result.answer).toBe('ok');
  });

  it('generateGeneral sends the question alone (no inlined context) and returns trimmed text', async () => {
    fetchMock.mockResolvedValue(okResponse('  Paris.  '));
    const provider = new OpenAICompatibleGenerationProvider('http://localhost:11434/v1', 'model');

    const answer = await provider.generateGeneral('capital of France?');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toBe('capital of France?'); // no "Context:" wrapper
    expect(body.messages[1].content).not.toContain('Context:');
    expect(answer).toBe('Paris.');
  });

  it('throws on a non-ok response without leaking the key', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' });
    const provider = new OpenAICompatibleGenerationProvider(
      'http://localhost:11434/v1',
      'model',
      KEY,
    );
    await expect(provider.generate('q', [chunk()])).rejects.toThrow(/401/);
    await expect(provider.generate('q', [chunk()])).rejects.not.toThrow(new RegExp(KEY));
  });
});
