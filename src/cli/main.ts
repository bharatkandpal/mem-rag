#!/usr/bin/env node
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IngestionService } from '../ingestion/ingestion.service';
import { GenerationService } from '../generation/generation.service';
import { CorrelatedLogger } from '../observability/correlated-logger';
import { runWithCorrelation } from '../observability/correlation.als';
import { formatIngestStats, formatInitResult, formatQueryResult } from './format';
import { runInit } from './init';

/**
 * The `rag` CLI (GO-21h, RAG-52): a terminal front-end over the same services
 * the API uses — one pipeline, two entrypoints. Bootstraps the Nest app
 * context in-process (same pattern as eval/run-eval.ts); no HTTP involved.
 */

type AppContext = Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;

async function withApp(fn: (app: AppContext) => Promise<void>): Promise<void> {
  // Bootstrap silent (no Nest init noise on the CLI), then attach the correlated
  // logger and run the command body inside one ALS scope (RAG-63g) so every
  // operational RAG-42 log line for this invocation carries the same id. The
  // formatted result still prints via console.log — logs are the diagnostics.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  // Logs → stderr so stdout stays a clean, pipeable result (RAG-63g).
  app.useLogger(new CorrelatedLogger('stderr'));
  try {
    await runWithCorrelation(() => fn(app), randomUUID());
  } finally {
    await app.close();
  }
}

const program = new Command();

program
  .name('rag')
  .description('Citation-grounded RAG over your document corpus (in-process, no API server needed)');

program
  .command('ingest')
  .description('Chunk, embed, and store a folder (or file) of documents')
  .argument('<path>', 'path to a document file or folder')
  .action(async (path: string) => {
    await withApp(async (app) => {
      const stats = await app.get(IngestionService).ingest(path);
      console.log(formatIngestStats(path, stats));
    });
  });

program
  .command('query')
  .description('Ask a question over the ingested corpus; prints a cited answer')
  .argument('<question>', 'the question to ask')
  .action(async (question: string) => {
    await withApp(async (app) => {
      const result = await app.get(GenerationService).generate(question);
      console.log(formatQueryResult(result));
    });
  });

program
  .command('init')
  .description(
    'Scaffold the RAG capability into a host project (RagModule wiring, env, compose, schema)',
  )
  .option('--target <dir>', 'directory to scaffold into', process.cwd())
  .option('--force', 'overwrite files that already exist', false)
  .option('--dry-run', 'report what would be written, without touching the filesystem', false)
  .action(async (opts: { target: string; force: boolean; dryRun: boolean }) => {
    // No app context here — init only writes files, no DB/adapter access needed.
    const result = await runInit({
      target: resolve(opts.target),
      force: opts.force,
      dryRun: opts.dryRun,
    });
    console.log(formatInitResult(result, opts.dryRun));
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
