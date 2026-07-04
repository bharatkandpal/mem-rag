import { RetrievedChunk } from '../src/vector-store/vector-store.interface';

export interface EvalEntry {
  question: string;
  /** Empty array ⇒ out-of-corpus: retrieval should return nothing above the floor (abstain, D5/RAG-57). */
  relevant_doc_ids: string[];
}

export interface EvalResult {
  question: string;
  /** Answerable: a relevant chunk was retrieved. Should-abstain: retrieval correctly returned nothing. */
  hit: boolean;
  precision: number;
  /** True for out-of-corpus entries (empty relevant_doc_ids). */
  expectAbstain?: boolean;
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

/** A should-abstain entry is correct when nothing cleared the score floor. */
export function computeAbstain(chunks: RetrievedChunk[]): {
  hit: boolean;
  precision: number;
} {
  const correct = chunks.length === 0;
  return { hit: correct, precision: correct ? 1 : 0 };
}

const COL = 50;

export function formatTable(results: EvalResult[], k: number): string {
  const answerable = results.filter((r) => !r.expectAbstain);
  const abstain = results.filter((r) => r.expectAbstain);

  const header = `${'question'.padEnd(COL)}  hit    prec@${k}`;
  const sep = '─'.repeat(header.length);
  const row = (r: EvalResult, mark: string) => {
    const q =
      r.question.length > COL - 1
        ? r.question.slice(0, COL - 4) + '...'
        : r.question;
    return `${q.padEnd(COL)}  ${mark}      ${r.precision.toFixed(2)}`;
  };

  const lines = [header, sep, ...answerable.map((r) => row(r, r.hit ? '✓' : '✗'))];

  if (abstain.length > 0) {
    lines.push(sep, `${'should abstain (out-of-corpus)'.padEnd(COL)}  abst.`);
    lines.push(...abstain.map((r) => row(r, r.hit ? '✓' : '✗')));
  }

  const hits = answerable.filter((r) => r.hit).length;
  const avgPrec =
    answerable.reduce((s, r) => s + r.precision, 0) / (answerable.length || 1);
  let summary = `hit-rate: ${hits}/${answerable.length} (${((hits / (answerable.length || 1)) * 100).toFixed(1)}%)   avg precision@${k}: ${avgPrec.toFixed(2)}`;
  if (abstain.length > 0) {
    const correct = abstain.filter((r) => r.hit).length;
    summary += `   abstain-rate: ${correct}/${abstain.length} (${((correct / abstain.length) * 100).toFixed(1)}%)`;
  }

  return [...lines, sep, summary].join('\n');
}
