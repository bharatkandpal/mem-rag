import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { RetrievalService } from '../src/retrieval/retrieval.service';
import {
  computeMetrics,
  EvalEntry,
  EvalResult,
  formatTable,
} from './metrics';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  const retrieval = app.get(RetrievalService);

  const datasetPath = join(__dirname, 'dataset.jsonl');
  const entries: EvalEntry[] = readFileSync(datasetPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as EvalEntry);

  const results: EvalResult[] = [];
  for (const entry of entries) {
    const chunks = await retrieval.retrieve(entry.question);
    const { hit, precision } = computeMetrics(chunks, entry.relevant_doc_ids);
    results.push({ question: entry.question, hit, precision });
  }

  await app.close();

  const k = Number(process.env.RETRIEVAL_K ?? 5);
  console.log(formatTable(results, k));

  const hitRate = results.filter((r) => r.hit).length / results.length;
  const minHitRate = Number(process.env.EVAL_MIN_HIT_RATE ?? 0.5);
  if (hitRate < minHitRate) {
    console.error(
      `\nFAIL: hit-rate ${(hitRate * 100).toFixed(1)}% is below floor ${(minHitRate * 100).toFixed(1)}%`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
