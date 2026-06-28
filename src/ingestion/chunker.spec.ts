import { chunk, ChunkOptions } from './chunker';
import { countTokens } from './tokenizer';

const opts = (o: Partial<ChunkOptions> = {}): ChunkOptions => ({
  chunkTokens: 30,
  overlapTokens: 8,
  ...o,
});

// A multi-paragraph doc with many short sentences — large enough to span chunks.
const sentences = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} here.`);
const paragraphs = [
  sentences.slice(0, 14).join(' '),
  sentences.slice(14, 27).join(' '),
  sentences.slice(27).join(' '),
];
const doc = paragraphs.join('\n\n');

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('chunk', () => {
  it('returns [] for empty / whitespace-only input', () => {
    expect(chunk('', opts())).toEqual([]);
    expect(chunk('   \n\n  ', opts())).toEqual([]);
  });

  it('keeps a short doc as a single chunk', () => {
    const out = chunk('A tiny document.', opts());
    expect(out).toHaveLength(1);
    expect(out[0].chunkIndex).toBe(0);
  });

  it('never exceeds chunkTokens + overlapTokens per chunk', () => {
    const o = opts();
    for (const c of chunk(doc, o)) {
      expect(countTokens(c.content)).toBeLessThanOrEqual(o.chunkTokens + o.overlapTokens);
    }
  });

  it('assigns sequential chunk indexes from 0', () => {
    const out = chunk(doc, opts());
    expect(out.map((c) => c.chunkIndex)).toEqual(out.map((_, i) => i));
  });

  it('drops no content when overlap is 0 (whitespace-normalised)', () => {
    const out = chunk(doc, opts({ overlapTokens: 0 }));
    expect(normalize(out.map((c) => c.content).join(' '))).toBe(normalize(doc));
  });

  it('carries overlap context: total tokens grow with overlap', () => {
    const sum = (over: number) =>
      chunk(doc, opts({ overlapTokens: over })).reduce(
        (n, c) => n + countTokens(c.content),
        0,
      );
    expect(sum(8)).toBeGreaterThan(sum(0));
  });

  it('hard-splits a single oversized segment with no separators', () => {
    const giant = 'x'.repeat(2000); // one token-dense blob, no spaces
    const o = opts();
    const out = chunk(giant, o);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(countTokens(c.content)).toBeLessThanOrEqual(o.chunkTokens + o.overlapTokens);
    }
  });
});
