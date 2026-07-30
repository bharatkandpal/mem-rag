import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { GenerationOutput, GenerationProvider } from './generation-provider.interface';
import { CitationVerifyingGenerationProvider } from './citation-verifying-generation.provider';

/**
 * The wrapped provider never claims citations of its own (it's typically
 * `OpenAICompatibleGenerationProvider`, which always returns `[]`) — this
 * fake stands in for it so these tests exercise only the verification logic:
 * does a citation only appear when it's genuinely, checkably supported by a
 * chunk's actual text?
 */
class FakeInnerProvider implements GenerationProvider {
  readonly name = 'fake-inner';
  readonly supportsCitations = false;
  constructor(
    private readonly answer: string,
    private readonly generalAnswer = 'general answer',
  ) {}
  async generate(): Promise<GenerationOutput> {
    return { answer: this.answer, citations: [] };
  }
  async generateGeneral(): Promise<string> {
    return this.generalAnswer;
  }
}

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  content: 'Retrieval scores each chunk by cosine similarity over the HNSW index.',
  source: 'TDD.md',
  score: 0.9,
  ...over,
});

describe('CitationVerifyingGenerationProvider', () => {
  it('reports supportsCitations = true and names itself after the wrapped provider', () => {
    const provider = new CitationVerifyingGenerationProvider(new FakeInnerProvider('x'));
    expect(provider.supportsCitations).toBe(true);
    expect(provider.name).toBe('citation-verifying(fake-inner)');
  });

  it('credits a sentence that closely matches a chunk, quoting the exact chunk substring', async () => {
    const inner = new FakeInnerProvider(
      'Retrieval scores each chunk by cosine similarity over the HNSW index.',
    );
    const provider = new CitationVerifyingGenerationProvider(inner);
    const chunks = [chunk()];

    const { answer, citations } = await provider.generate('how is retrieval scored?', chunks);

    expect(answer).toBe(
      'Retrieval scores each chunk by cosine similarity over the HNSW index.',
    );
    expect(citations).toHaveLength(1);
    expect(citations[0].documentIndex).toBe(0);
    expect(citations[0].source).toBe('TDD.md');
    // citedText is sliced verbatim from the CHUNK's content, not the answer —
    // matches Claude's char_location semantics (a quote from the source).
    expect(chunks[0].content).toContain(citations[0].citedText);
    expect(citations[0].citedText.split(/\s+/).length).toBeGreaterThanOrEqual(6);
  });

  it('never credits a sentence with only loose/short overlap — no fabricated citation', async () => {
    const inner = new FakeInnerProvider('The system uses a database for storage.');
    const provider = new CitationVerifyingGenerationProvider(inner);
    const chunks = [chunk({ content: 'Bake sourdough bread at 230°C for 35 minutes.' })];

    const { citations } = await provider.generate('q', chunks);

    expect(citations).toEqual([]);
  });

  it('maps each sentence to its own best-matching chunk (multi-sentence, multi-chunk)', async () => {
    const answer =
      'Retrieval scores each chunk by cosine similarity over the HNSW index. ' +
      'The chunker is token-aware and uses a recursive structure with overlap.';
    const inner = new FakeInnerProvider(answer);
    const provider = new CitationVerifyingGenerationProvider(inner);
    const chunks = [
      chunk({ source: 'TDD.md', content: 'Retrieval scores each chunk by cosine similarity over the HNSW index.' }),
      chunk({
        source: 'GO-21.md',
        content: 'The chunker is token-aware and uses a recursive structure with overlap.',
      }),
    ];

    const { citations } = await provider.generate('q', chunks);

    expect(citations).toHaveLength(2);
    expect(citations.find((c) => c.documentIndex === 0)?.source).toBe('TDD.md');
    expect(citations.find((c) => c.documentIndex === 1)?.source).toBe('GO-21.md');
  });

  it('returns no citations, without error, when there are no chunks', async () => {
    const provider = new CitationVerifyingGenerationProvider(new FakeInnerProvider('Some answer.'));
    const { citations } = await provider.generate('q', []);
    expect(citations).toEqual([]);
  });

  it('delegates generateGeneral unchanged — the ungrounded path has nothing to verify', async () => {
    const provider = new CitationVerifyingGenerationProvider(
      new FakeInnerProvider('unused', 'Paris.'),
    );
    const answer = await provider.generateGeneral('capital of France?');
    expect(answer).toBe('Paris.');
  });

  it('respects custom minMatchWords / minOverlapRatio thresholds', async () => {
    // A short but exact 3-word overlap: rejected at the default 6-word floor...
    const inner = new FakeInnerProvider('Chunks use overlap.');
    const strict = new CitationVerifyingGenerationProvider(inner);
    const chunks = [chunk({ content: 'Chunks use overlap between adjacent windows.' })];
    expect((await strict.generate('q', chunks)).citations).toEqual([]);

    // ...but accepted once the caller lowers the floor.
    const lenient = new CitationVerifyingGenerationProvider(inner, 2, 0.5);
    const { citations } = await lenient.generate('q', chunks);
    expect(citations).toHaveLength(1);
  });
});
