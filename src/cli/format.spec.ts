import { formatIngestStats, formatQueryResult } from './format';
import { QueryResult } from '../generation/generation.service';

describe('formatIngestStats', () => {
  it('reports docs, chunks, path, and duration', () => {
    const out = formatIngestStats('./docs', { docs: 3, chunks: 9, ms: 42 });
    expect(out).toBe('Ingested 3 docs → 9 chunks from ./docs in 42ms');
  });
});

describe('formatQueryResult', () => {
  const base: QueryResult = {
    answer: 'pgvector stores embeddings in Postgres.',
    citations: [],
    chunks: [],
    abstained: false,
    citationsSupported: true,
  };

  it('prints the answer with a numbered citation list', () => {
    const out = formatQueryResult({
      ...base,
      citations: [
        { citedText: 'pgvector adds a vector type', source: 'docs/db.md', documentIndex: 0 },
        { citedText: 'HNSW index for ANN search', source: 'docs/index.md', documentIndex: 1 },
      ],
    });
    expect(out).toContain('pgvector stores embeddings in Postgres.');
    expect(out).toContain('Citations:');
    expect(out).toContain('  [1] docs/db.md — "pgvector adds a vector type"');
    expect(out).toContain('  [2] docs/index.md — "HNSW index for ANN search"');
  });

  it('passes the abstain answer through verbatim with no citation section', () => {
    const out = formatQueryResult({
      ...base,
      answer: "I don't have that information in the corpus.",
      abstained: true,
    });
    expect(out).toBe("I don't have that information in the corpus.");
  });

  it('notes when the provider cannot verify citations (never fakes them)', () => {
    const out = formatQueryResult({ ...base, citationsSupported: false });
    expect(out).toContain('does not support citations');
  });

  it('adds no capability note when a citation-capable provider returns none', () => {
    const out = formatQueryResult(base);
    expect(out).toBe('pgvector stores embeddings in Postgres.');
  });
});
