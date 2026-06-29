import { RetrievedChunk } from '../src/vector-store/vector-store.interface';

export interface EvalEntry {
  question: string;
  relevant_doc_ids: string[];
}

export interface EvalResult {
  question: string;
  hit: boolean;
  precision: number;
}

export function computeMetrics(
  chunks: RetrievedChunk[],
  relevantDocIds: string[],
): { hit: boolean; precision: number } {
  if (chunks.length === 0) return { hit: false, precision: 0 };
  const hit = chunks.some((c) => relevantDocIds.includes(c.source));
  const precision =
    chunks.filter((c) => relevantDocIds.includes(c.source)).length /
    chunks.length;
  return { hit, precision };
}

const COL = 50;

export function formatTable(results: EvalResult[], k: number): string {
  const header = `${'question'.padEnd(COL)}  hit    prec@${k}`;
  const sep = '─'.repeat(header.length);
  const rows = results.map((r) => {
    const q =
      r.question.length > COL - 1
        ? r.question.slice(0, COL - 4) + '...'
        : r.question;
    return `${q.padEnd(COL)}  ${r.hit ? '✓' : '✗'}      ${r.precision.toFixed(2)}`;
  });
  const hits = results.filter((r) => r.hit).length;
  const avgPrec =
    results.reduce((s, r) => s + r.precision, 0) / results.length;
  const summary = `hit-rate: ${hits}/${results.length} (${((hits / results.length) * 100).toFixed(1)}%)   avg precision@${k}: ${avgPrec.toFixed(2)}`;
  return [header, sep, ...rows, sep, summary].join('\n');
}
