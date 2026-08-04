import { renderQueryResult } from './render';
import type { QueryResult } from '../generation/generation.service';

// A grounded, citation-capable result; individual tests override the fields they exercise.
const base: QueryResult = {
  answer: '',
  citations: [],
  chunks: [],
  abstained: false,
  grounded: true,
  citationsSupported: true,
};

describe('renderQueryResult', () => {
  it('renders the answer followed by a numbered Sources list when citations are present', () => {
    const out = renderQueryResult({
      ...base,
      answer: 'Retrieval is scored by hit-rate and precision@k.',
      citations: [
        { citedText: 'hit-rate and precision@k', source: 'TDD.md', documentIndex: 0 },
        { citedText: 'first-class deliverable', source: 'PRD.md', documentIndex: 1 },
      ],
    });
    expect(out).toContain('Retrieval is scored by hit-rate and precision@k.');
    expect(out).toContain('Sources:');
    expect(out).toContain('[1] "hit-rate and precision@k" — TDD.md');
    expect(out).toContain('[2] "first-class deliverable" — PRD.md');
  });

  it('passes an abstain answer through verbatim with no Sources section (D5)', () => {
    const message = "I don't have that information in the corpus.";
    const out = renderQueryResult({
      ...base,
      answer: message,
      abstained: true,
      grounded: false,
    });
    expect(out).toBe(message);
    expect(out).not.toContain('Sources:');
  });

  it('adds an honest capability note when the provider cannot cite — never a fabricated citation', () => {
    const out = renderQueryResult({
      ...base,
      answer: 'A grounded answer from a local model.',
      citations: [],
      citationsSupported: false,
    });
    expect(out).toContain('A grounded answer from a local model.');
    expect(out).toContain('does not support citations');
    expect(out).not.toContain('Sources:');
  });

  it('omits the capability note for an abstain even when citations are unsupported', () => {
    const out = renderQueryResult({
      ...base,
      answer: 'nope',
      abstained: true,
      grounded: false,
      citationsSupported: false,
    });
    expect(out).toBe('nope');
  });
});
