import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { RetrievalService } from '../src/retrieval/retrieval.service';
import {
  computeAbstain,
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
    const expectAbstain = entry.relevant_doc_ids.length === 0;
    const { hit, precision } = expectAbstain
      ? computeAbstain(chunks)
      : computeMetrics(chunks, entry.relevant_doc_ids);
    results.push({ question: entry.question, hit, precision, expectAbstain });
  }

  await app.close();

  const k = Number(process.env.RETRIEVAL_K ?? 5);
  console.log(formatTable(results, k));

  const answerable = results.filter((r) => !r.expectAbstain);
  const hitRate =
    answerable.filter((r) => r.hit).length / (answerable.length || 1);
  const minHitRate = Number(process.env.EVAL_MIN_HIT_RATE ?? 0.5);
  if (hitRate < minHitRate) {
    console.error(
      `\nFAIL: hit-rate ${(hitRate * 100).toFixed(1)}% is below floor ${(minHitRate * 100).toFixed(1)}%`,
    );
    process.exit(1);
  }

  // Abstain gate (RAG-57): out-of-corpus entries must return nothing above the floor.
  const abstain = results.filter((r) => r.expectAbstain);
  if (abstain.length > 0) {
    const abstainRate = abstain.filter((r) => r.hit).length / abstain.length;
    const minAbstainRate = Number(process.env.EVAL_MIN_ABSTAIN_RATE ?? 0.5);
    if (abstainRate < minAbstainRate) {
      console.error(
        `\nFAIL: abstain-rate ${(abstainRate * 100).toFixed(1)}% is below floor ${(minAbstainRate * 100).toFixed(1)}%`,
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
