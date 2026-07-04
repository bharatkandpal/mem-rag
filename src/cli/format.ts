import { IngestStats } from '../ingestion/ingestion.service';
import { QueryResult } from '../generation/generation.service';

/**
 * Pure stdout formatting for the CLI (RAG-53/54). Kept free of Nest/DI so it
 * unit-tests without an app context; `main.ts` stays a thin wiring layer.
 */

export function formatIngestStats(path: string, stats: IngestStats): string {
  return `Ingested ${stats.docs} docs → ${stats.chunks} chunks from ${path} in ${stats.ms}ms`;
}

export function formatQueryResult(result: QueryResult): string {
  // The abstain answer passes through verbatim — never mask it (D5).
  const lines: string[] = [result.answer];

  if (result.citations.length > 0) {
    lines.push('', 'Citations:');
    result.citations.forEach((c, i) => {
      lines.push(`  [${i + 1}] ${c.source} — "${c.citedText}"`);
    });
  } else if (!result.abstained && !result.citationsSupported) {
    // Honest capability note (RAG-62): no citations because the configured
    // provider can't verify them — not because the answer is ungrounded.
    lines.push('', '(configured generation provider does not support citations)');
  }

  return lines.join('\n');
}
