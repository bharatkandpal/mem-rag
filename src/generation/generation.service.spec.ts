import { MetricsService } from '../observability/metrics.service';
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
  let generateGeneral: jest.Mock;
  let metrics: { recordQuery: jest.Mock; observeGeneration: jest.Mock };
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
    generateGeneral = jest.fn();
    const provider = {
      name: 'test',
      supportsCitations,
      generate,
      generateGeneral,
    } as unknown as GenerationProvider;
    const retrieval = { retrieve } as unknown as RetrievalService;
    metrics = { recordQuery: jest.fn(), observeGeneration: jest.fn() };
    service = new GenerationService(provider, retrieval, metrics as unknown as MetricsService);
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

  it('marks corpus-grounded answers grounded=true', async () => {
    retrieve.mockResolvedValue([chunk()]);
    generate.mockResolvedValue({ answer: 'ok', citations: [] });

    const result = await service.generate('q');

    expect(result.grounded).toBe(true);
    expect(result.abstained).toBe(false);
  });

  it('generateGeneral bypasses retrieval and returns an ungrounded answer (grounded=false, no citations)', async () => {
    const result = await service.generateGeneral('what is the capital of France?');

    expect(generateGeneral).toHaveBeenCalledWith('what is the capital of France?');
    expect(retrieve).not.toHaveBeenCalled(); // must not touch the corpus
    expect(generate).not.toHaveBeenCalled(); // must not use the grounded path
    expect(result.grounded).toBe(false);
    expect(result.abstained).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.chunks).toEqual([]);
  });

  // RAG-63e — outcome mapping is the nuanced part: abstain and the opt-in
  // general path must be counted distinctly, and generation timed only when a
  // provider call actually happens.
  it('records outcome=grounded + times generation on the happy path', async () => {
    retrieve.mockResolvedValue([chunk()]);
    generate.mockResolvedValue({ answer: 'ok', citations: [] });

    await service.generate('q');

    expect(metrics.recordQuery).toHaveBeenCalledWith('grounded');
    expect(metrics.observeGeneration).toHaveBeenCalledWith('test', expect.any(Number));
  });

  it('records outcome=abstained and never times generation when abstaining', async () => {
    retrieve.mockResolvedValue([]);

    await service.generate('q');

    expect(metrics.recordQuery).toHaveBeenCalledWith('abstained');
    expect(metrics.observeGeneration).not.toHaveBeenCalled();
  });

  it('records outcome=general for the opt-in ungrounded path', async () => {
    await service.generateGeneral('q');

    expect(metrics.recordQuery).toHaveBeenCalledWith('general');
    expect(metrics.observeGeneration).toHaveBeenCalledWith('test', expect.any(Number));
  });
});
