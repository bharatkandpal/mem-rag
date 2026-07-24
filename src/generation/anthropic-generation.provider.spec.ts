import type Anthropic from '@anthropic-ai/sdk';
import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { AnthropicGenerationProvider } from './anthropic-generation.provider';

/**
 * The document-block + citation-mapping shape is the part that must match the
 * live Anthropic API exactly — verified against the `claude-api` reference,
 * not memory (rule `ai-and-secrets.md`).
 */
describe('AnthropicGenerationProvider', () => {
  let create: jest.Mock;
  let provider: AnthropicGenerationProvider;

  const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
    content: 'The sky is blue.',
    source: 'facts.md',
    score: 0.9,
    ...over,
  });

  beforeEach(() => {
    create = jest.fn();
    const client = { messages: { create } } as unknown as Anthropic;
    provider = new AnthropicGenerationProvider(client);
  });

  it('reports supportsCitations = true', () => {
    expect(provider.supportsCitations).toBe(true);
  });

  it('passes chunks as citable document blocks', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'Blue.' }] });

    await provider.generate('q', [chunk({ source: 'a.md' }), chunk({ source: 'b.md' })]);

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

    const result = await provider.generate('q', [
      chunk({ source: 'a.md' }),
      chunk({ source: 'b.md' }),
    ]);

    expect(result.answer).toBe('The sky is blue per the facts.');
    expect(result.citations).toEqual([
      { citedText: 'The sky is blue.', source: 'b.md', documentIndex: 1 },
    ]);
  });

  it('generateGeneral sends no document blocks and returns plain ungrounded text', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: '  Paris is the capital.  ' }] });

    const answer = await provider.generateGeneral('capital of France?');

    const req = create.mock.calls[0][0];
    // No corpus documents — the question is the whole user message.
    expect(req.messages[0].content).toBe('capital of France?');
    expect(JSON.stringify(req)).not.toContain('"type":"document"');
    expect(answer).toBe('Paris is the capital.'); // trimmed, no citations returned
  });

  it('defaults to claude-opus-4-8 unless a model is provided', async () => {
    create.mockResolvedValue({ content: [] });
    await provider.generate('q', [chunk()]);
    expect(create.mock.calls[0][0].model).toBe('claude-opus-4-8');
  });

  it('uses a custom model when provided', async () => {
    const custom = new AnthropicGenerationProvider(
      { messages: { create } } as unknown as Anthropic,
      'claude-haiku-4-5',
    );
    create.mockResolvedValue({ content: [] });
    await custom.generate('q', [chunk()]);
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5');
  });
});
