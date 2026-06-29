import { computeMetrics, formatTable } from './metrics';
import { RetrievedChunk } from '../src/vector-store/vector-store.interface';

const chunk = (source: string, score = 0.9): RetrievedChunk => ({
  content: 'text',
  source,
  score,
});

describe('computeMetrics', () => {
  it('returns hit=true and correct precision when one of two chunks is relevant', () => {
    const result = computeMetrics([chunk('TDD.md'), chunk('PRD.md')], ['TDD.md']);
    expect(result.hit).toBe(true);
    expect(result.precision).toBeCloseTo(0.5);
  });

  it('returns hit=false and precision=0 when no chunk matches relevant_doc_ids', () => {
    const result = computeMetrics([chunk('README.md')], ['TDD.md']);
    expect(result.hit).toBe(false);
    expect(result.precision).toBe(0);
  });

  it('returns hit=false and precision=0 for empty chunk list (abstain case)', () => {
    const result = computeMetrics([], ['TDD.md']);
    expect(result.hit).toBe(false);
    expect(result.precision).toBe(0);
  });

  it('returns precision=1 when all chunks are relevant', () => {
    const result = computeMetrics(
      [chunk('TDD.md'), chunk('TDD.md')],
      ['TDD.md'],
    );
    expect(result.precision).toBe(1);
  });

  it('handles multiple relevant_doc_ids correctly', () => {
    const result = computeMetrics(
      [chunk('TDD.md'), chunk('PRD.md'), chunk('GO-21.md')],
      ['TDD.md', 'PRD.md'],
    );
    expect(result.hit).toBe(true);
    expect(result.precision).toBeCloseTo(2 / 3);
  });
});

describe('formatTable', () => {
  it('includes hit-rate summary with correct counts', () => {
    const results = [
      { question: 'q1', hit: true, precision: 0.5 },
      { question: 'q2', hit: false, precision: 0 },
    ];
    const output = formatTable(results, 5);
    expect(output).toContain('hit-rate: 1/2');
    expect(output).toContain('50.0%');
    expect(output).toContain('prec@5');
  });

  it('truncates long questions to keep table readable', () => {
    const longQ = 'A'.repeat(60);
    const results = [{ question: longQ, hit: true, precision: 1 }];
    const output = formatTable(results, 5);
    expect(output).toContain('...');
  });
});
