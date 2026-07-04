import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
} from '../src/embedding/embedding-provider.interface';
import {
  VECTOR_STORE,
  VectorStore,
} from '../src/vector-store/vector-store.interface';
import { EvalEntry } from './metrics';

/**
 * Score-distribution probe (RAG-57): prints raw top-k similarity scores for
 * the labeled in-corpus questions vs. a set of out-of-corpus questions,
 * bypassing the MIN_SCORE floor — the data a floor calibration is based on.
 * Not part of `npm run eval`; run ad hoc:
 *   ts-node --project tsconfig.eval.json eval/probe-scores.ts
 */

const OUT_OF_CORPUS = [
  'What is the capital of France?',
  'How do I bake sourdough bread?',
  'Who won the 2022 FIFA World Cup?',
  'How do I configure a Kubernetes ingress controller?', // tech-adjacent — the hard case
  'What does the useEffect hook do in React?', // tech-adjacent — the hard case
  'zxqvw blorptang frimble?',
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const embedder = app.get<EmbeddingProvider>(EMBEDDING_PROVIDER);
  const store = app.get<VectorStore>(VECTOR_STORE);
  const k = Number(process.env.RETRIEVAL_K ?? 5);

  const inCorpus: EvalEntry[] = readFileSync(join(__dirname, 'dataset.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as EvalEntry)
    .filter((e) => e.relevant_doc_ids.length > 0);

  const probe = async (label: string, questions: string[]) => {
    console.log(`\n=== ${label} ===`);
    for (const q of questions) {
      const [embedding] = await embedder.embed([q]);
      const hits = await store.search(embedding, k);
      const scores = hits.map((h) => h.score.toFixed(3)).join(' ');
      console.log(`${q.slice(0, 55).padEnd(56)} ${scores}`);
    }
  };

  await probe(
    'IN-CORPUS (labeled questions)',
    inCorpus.map((e) => e.question),
  );
  await probe('OUT-OF-CORPUS', OUT_OF_CORPUS);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
