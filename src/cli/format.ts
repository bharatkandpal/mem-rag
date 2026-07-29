import { IngestStats } from '../ingestion/ingestion.service';
import { QueryResult } from '../generation/generation.service';
import { InitResult } from './init';

/**
 * Pure stdout formatting for the CLI (RAG-53/54, RAG-66d). Kept free of
 * Nest/DI (and, for init, of the filesystem) so it unit-tests without an app
 * context; `main.ts` stays a thin wiring layer.
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

const OUTCOME_LABEL: Record<InitResult['files'][number]['outcome'], string> = {
  written: 'written',
  skipped: 'skipped (already exists — use --force to overwrite)',
  'would-write': 'would write (--dry-run)',
};

export function formatInitResult(result: InitResult, dryRun: boolean): string {
  const lines: string[] = [`Scaffolding into ${result.target}:`];
  for (const file of result.files) {
    lines.push(`  ${file.relativePath} — ${OUTCOME_LABEL[file.outcome]}`);
  }

  if (dryRun) {
    lines.push('', 'Dry run — no files were written.');
    return lines.join('\n');
  }

  lines.push(
    '',
    'Next steps:',
    '  1. Add HostRagModule (src/rag/rag.module.ts) to your AppModule imports.',
    '  2. Copy .env.rag.example to .env and fill in your keys.',
    '  3. Get Postgres+pgvector: docker compose -f docker-compose.rag.yml up -d',
    '     (or point DATABASE_URL at Postgres you already run).',
    '  4. Apply db/rag/001_init.sql — see the runner command in that file.',
    '  5. Ingest a folder and query — same IngestionService/GenerationService, now embedded.',
  );
  return lines.join('\n');
}
