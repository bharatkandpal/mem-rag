import { ConfigService } from '@nestjs/config';
import type Anthropic from '@anthropic-ai/sdk';
import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { RetrievalService } from '../retrieval/retrieval.service';
import { GenerationService } from './generation.service';

/**
 * Generation tests: retrieval and the Anthropic client are mocked. We assert the
 * abstain path (no model call), the citable-document shape sent to Claude, and
 * that response citations map back to the source chunk via document_index.
 */
describe('GenerationService', () => {
  let retrieve: jest.Mock;
  let create: jest.Mock;
  let service: GenerationService;

  const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
    content: 'The sky is blue.',
    source: 'facts.md',
    score: 0.9,
    ...over,
  });

  const build = () => {
    retrieve = jest.fn();
    create = jest.fn();
    const client = { messages: { create } } as unknown as Anthropic;
    const retrieval = { retrieve } as unknown as RetrievalService;
    const config = { get: (_k: string, d: unknown) => d } as unknown as ConfigService;
    service = new GenerationService(client, retrieval, config);
  };

  beforeEach(build);

  it('abstains without calling the model when retrieval is empty', async () => {
    retrieve.mockResolvedValue([]);

    const result = await service.generate('why is the sky blue?');

    expect(create).not.toHaveBeenCalled();
    expect(result.abstained).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.chunks).toEqual([]);
  });

  it('passes chunks as citable document blocks', async () => {
    retrieve.mockResolvedValue([chunk({ source: 'a.md' }), chunk({ source: 'b.md' })]);
    create.mockResolvedValue({ content: [{ type: 'text', text: 'Blue.' }] });

    await service.generate('q');

    const req = create.mock.calls[0][0];
    const docs = req.messages[0].content.filter((b: { type: string }) => b.type === 'document');
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({
      type: 'document',
      source: { type: 'text', media_type: 'text/plain' },
      title: 'a.md',
      citations: { enabled: true },
    });
    // The question rides as the trailing text block.
    expect(req.messages[0].content.at(-1)).toEqual({ type: 'text', text: 'q' });
  });

  it('assembles the answer and maps citations to the source chunk', async () => {
    retrieve.mockResolvedValue([chunk({ source: 'a.md' }), chunk({ source: 'b.md' })]);
    create.mockResolvedValue({
      content: [
        { type: 'text', text: 'The sky is blue ' },
        {
          type: 'text',
          text: 'per the facts.',
          citations: [
            {
              type: 'char_location',
              cited_text: 'The sky is blue.',
              document_index: 1,
              document_title: 'b.md',
              start_char_index: 0,
              end_char_index: 16,
            },
          ],
        },
      ],
    });

    const result = await service.generate('q');

    expect(result.answer).toBe('The sky is blue per the facts.');
    expect(result.abstained).toBe(false);
    expect(result.citations).toEqual([
      { citedText: 'The sky is blue.', source: 'b.md', documentIndex: 1 },
    ]);
  });
});
