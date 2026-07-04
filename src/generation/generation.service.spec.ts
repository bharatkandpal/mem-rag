import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { GenerationProvider } from './generation-provider.interface';
import { GenerationService } from './generation.service';

/**
 * Orchestration tests only — the model call itself is covered by each
 * provider's own spec. What matters here: abstain-on-empty-retrieval never
 * calls the provider (D5, provider-agnostic), the retrieved chunks pass
 * through unchanged, and citationsSupported is surfaced honestly regardless
 * of which provider is configured.
 */
describe('GenerationService', () => {
  let retrieve: jest.Mock;
  let generate: jest.Mock;
  let service: GenerationService;

  const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
    content: 'The sky is blue.',
    source: 'facts.md',
    score: 0.9,
    ...over,
  });

  const build = (supportsCitations = true) => {
    retrieve = jest.fn();
    generate = jest.fn();
    const provider = { supportsCitations, generate } as unknown as GenerationProvider;
    const retrieval = { retrieve } as unknown as RetrievalService;
    service = new GenerationService(provider, retrieval);
  };

  beforeEach(() => build());

  it('abstains without calling the provider when retrieval is empty', async () => {
    retrieve.mockResolvedValue([]);

    const result = await service.generate('why is the sky blue?');

    expect(generate).not.toHaveBeenCalled();
    expect(result.abstained).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.chunks).toEqual([]);
    expect(result.citationsSupported).toBe(true);
  });

  it('delegates to the provider with the retrieved chunks and returns its output', async () => {
    const chunks = [chunk({ source: 'a.md' }), chunk({ source: 'b.md' })];
    retrieve.mockResolvedValue(chunks);
    generate.mockResolvedValue({
      answer: 'The sky is blue.',
      citations: [{ citedText: 'The sky is blue.', source: 'b.md', documentIndex: 1 }],
    });

    const result = await service.generate('q');

    expect(generate).toHaveBeenCalledWith('q', chunks);
    expect(result.answer).toBe('The sky is blue.');
    expect(result.abstained).toBe(false);
    expect(result.chunks).toEqual(chunks);
    expect(result.citations).toEqual([
      { citedText: 'The sky is blue.', source: 'b.md', documentIndex: 1 },
    ]);
  });

  it('surfaces citationsSupported=false honestly for providers without native citations', async () => {
    build(false);
    retrieve.mockResolvedValue([chunk()]);
    generate.mockResolvedValue({ answer: 'ok', citations: [] });

    const result = await service.generate('q');

    expect(result.citationsSupported).toBe(false);
    expect(result.citations).toEqual([]);
  });
});
