# GO-21g — Retrieval Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run eval` — a standalone command that ingests a sample corpus, runs labeled questions through `RetrievalService`, and prints hit-rate + precision@k as the project's quantitative quality gate.

**Architecture:** A NestJS app context (no HTTP server) resolves `RetrievalService` directly and calls `retrieve()` for each question in `eval/dataset.jsonl`. Pure metric functions (`computeMetrics`, `formatTable`) live in `eval/metrics.ts` and are unit-tested separately from the script that drives them.

**Tech Stack:** NestJS (`NestFactory.createApplicationContext`), TypeScript, ts-node, Jest (unit tests for metrics), pgvector (live DB), Voyage (live embeddings).

## Global Constraints

- No new runtime dependencies — only add `ts-node` to devDependencies.
- `RetrievedChunk.source` is the match key for `relevant_doc_ids` — both are relative paths from the ingest root (e.g. `TDD.md`).
- `RetrievalService.retrieve()` applies the `MIN_SCORE` floor — eval numbers reflect production behaviour.
- Exit code 1 if hit-rate < `EVAL_MIN_HIT_RATE` (default 0.5) so CI can gate on it.
- `ts-node` must use `tsconfig.eval.json` (which adds `eval/**/*` to the includes) — the root `tsconfig.json` only covers `src/**/*`.
- Keep NestJS startup logs suppressed (`logger: false`) for clean output.

---

### Task 1: Scaffolding — ts-node, tsconfig.eval.json, package.json, jest.config.js

**Files:**
- Modify: `package.json`
- Create: `tsconfig.eval.json`
- Modify: `jest.config.js`

**Interfaces:**
- Produces: `npm run eval` entry point; `eval/` files resolvable by ts-node and Jest

- [ ] **Step 1: Add ts-node to devDependencies and eval script to package.json**

Open `package.json`. Make these two changes:

In `"scripts"`, add:
```json
"eval": "ts-node --project tsconfig.eval.json eval/run-eval.ts"
```

In `"devDependencies"`, add:
```json
"ts-node": "^10.9.2"
```

Final `scripts` block:
```json
"scripts": {
  "build": "nest build",
  "start": "node dist/main.js",
  "start:dev": "nest start --watch",
  "typecheck": "tsc --noEmit",
  "eval": "ts-node --project tsconfig.eval.json eval/run-eval.ts",
  "test": "jest",
  "test:watch": "jest --watch"
}
```

- [ ] **Step 2: Install ts-node**

```bash
npm install
```

Expected: `ts-node` appears in `node_modules/.bin/ts-node`.

- [ ] **Step 3: Create tsconfig.eval.json**

Create `/path/to/rag/tsconfig.eval.json`:
```json
{
  "extends": "./tsconfig.json",
  "include": ["src/**/*", "eval/**/*"]
}
```

This extends the root config (preserves `emitDecoratorMetadata`, `experimentalDecorators`, `strict`, etc.) and adds `eval/**/*` so ts-node can compile the runner and metrics files.

- [ ] **Step 4: Update jest.config.js to include eval/ in test roots**

Open `jest.config.js`. Change:
```js
roots: ['<rootDir>/src'],
```
to:
```js
roots: ['<rootDir>/src', '<rootDir>/eval'],
```

Full updated file:
```js
/** Jest config — ts-jest, unit tests live next to source as `*.spec.ts` (TDD §3). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/eval'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!**/main.ts'],
};
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.eval.json jest.config.js
git commit -m "chore(eval): scaffold ts-node, tsconfig.eval.json, npm run eval entry"
```

---

### Task 2: Sample corpus + labeled dataset

**Files:**
- Create: `eval/sample-corpus/README.md` (copy of root README.md)
- Create: `eval/sample-corpus/TDD.md` (copy of root TDD.md)
- Create: `eval/sample-corpus/PRD.md` (copy of root PRD.md)
- Create: `eval/sample-corpus/GO-21.md` (copy of root GO-21.md)
- Create: `eval/dataset.jsonl`

**Interfaces:**
- Produces: `eval/sample-corpus/` — the ingest path to give `POST /ingest`; `eval/dataset.jsonl` — the labeled question set consumed by the runner

- [ ] **Step 1: Create the sample-corpus directory and copy project docs**

```bash
mkdir -p eval/sample-corpus
cp README.md eval/sample-corpus/README.md
cp TDD.md    eval/sample-corpus/TDD.md
cp PRD.md    eval/sample-corpus/PRD.md
cp GO-21.md  eval/sample-corpus/GO-21.md
```

These four files are the entire corpus the labeled questions are written against. The `DocumentLoader` will set `docId = source = <filename>.md` (relative to `eval/sample-corpus/`) — matching exactly the `relevant_doc_ids` in the dataset below.

- [ ] **Step 2: Create eval/dataset.jsonl**

Create `eval/dataset.jsonl` with these 10 labeled entries (one JSON object per line, no trailing comma, no array wrapper):

```jsonl
{"question": "What embedding model does this project use by default?", "relevant_doc_ids": ["TDD.md"]}
{"question": "What vector index type is used for similarity search?", "relevant_doc_ids": ["TDD.md"]}
{"question": "How many dimensions do the embedding vectors stored in pgvector have?", "relevant_doc_ids": ["TDD.md"]}
{"question": "What database table stores document chunks and their embeddings?", "relevant_doc_ids": ["TDD.md"]}
{"question": "Which Claude model is used for answer generation?", "relevant_doc_ids": ["TDD.md", "PRD.md"]}
{"question": "What happens when retrieval finds no chunks above the score floor?", "relevant_doc_ids": ["TDD.md"]}
{"question": "What are the functional requirements of the system?", "relevant_doc_ids": ["PRD.md"]}
{"question": "How do I run the project locally?", "relevant_doc_ids": ["README.md"]}
{"question": "What are the build milestones and their order?", "relevant_doc_ids": ["GO-21.md"]}
{"question": "What is the purpose of the swappable embedding adapter?", "relevant_doc_ids": ["TDD.md", "PRD.md"]}
```

- [ ] **Step 3: Commit**

```bash
git add eval/sample-corpus/ eval/dataset.jsonl
git commit -m "feat(eval): add sample corpus and labeled dataset (GO-21g)"
```

---

### Task 3: Metrics module with unit tests

**Files:**
- Create: `eval/metrics.ts`
- Create: `eval/metrics.spec.ts`

**Interfaces:**
- Consumes: `RetrievedChunk` from `../src/vector-store/vector-store.interface`
- Produces:
  - `EvalEntry { question: string; relevant_doc_ids: string[] }` — one row from dataset.jsonl
  - `EvalResult { question: string; hit: boolean; precision: number }` — per-question outcome
  - `computeMetrics(chunks: RetrievedChunk[], relevantDocIds: string[]): { hit: boolean; precision: number }`
  - `formatTable(results: EvalResult[], k: number): string`

- [ ] **Step 1: Write the failing unit tests**

Create `eval/metrics.spec.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest eval/metrics.spec.ts --no-coverage
```

Expected: `Cannot find module './metrics'` — confirms the tests are wired correctly before implementation.

- [ ] **Step 3: Implement eval/metrics.ts**

Create `eval/metrics.ts`:
```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest eval/metrics.spec.ts --no-coverage
```

Expected: all 7 tests pass.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npm test -- --no-coverage
```

Expected: all existing tests still pass alongside the new ones.

- [ ] **Step 6: Commit**

```bash
git add eval/metrics.ts eval/metrics.spec.ts
git commit -m "feat(eval): metrics module — computeMetrics + formatTable with unit tests"
```

---

### Task 4: Runner script

**Files:**
- Create: `eval/run-eval.ts`

**Interfaces:**
- Consumes:
  - `AppModule` from `../src/app.module`
  - `RetrievalService` from `../src/retrieval/retrieval.service`
  - `EvalEntry`, `EvalResult`, `computeMetrics`, `formatTable` from `./metrics`
- Produces: `npm run eval` — prints table + summary, exits non-zero if hit-rate < `EVAL_MIN_HIT_RATE`

- [ ] **Step 1: Create eval/run-eval.ts**

Create `eval/run-eval.ts`:
```typescript
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
```

- [ ] **Step 2: Typecheck the eval files**

```bash
npx tsc --project tsconfig.eval.json --noEmit
```

Expected: no errors. If you see errors about missing types, check that `ts-node` is installed (`node_modules/.bin/ts-node` exists).

- [ ] **Step 3: Commit**

```bash
git add eval/run-eval.ts
git commit -m "feat(eval): runner script — NestJS app context, hit-rate + precision@k (GO-21g)"
```

---

### Task 5: End-to-end verification + README update

**Files:**
- Modify: `README.md` — add eval baseline number

**Interfaces:**
- Consumes: running Docker stack (`docker compose up -d`), ingested sample corpus

- [ ] **Step 1: Bring up the Docker stack**

```bash
docker compose up -d
```

Wait ~10 seconds, then verify:
```bash
curl -s localhost:3000/healthz
```

Expected: `{"status":"ok","db":true,"pgvector":true}`

- [ ] **Step 2: Ingest the sample corpus**

```bash
curl -s -X POST localhost:3000/ingest \
  -H 'Content-Type: application/json' \
  -d "{\"path\": \"$(pwd)/eval/sample-corpus\"}" | jq
```

Expected: `{"docs":4,"chunks":<n>,"ms":<n>}` — 4 documents ingested.

- [ ] **Step 3: Run the eval**

```bash
npm run eval
```

Expected: a table printed to stdout, followed by a summary line like:
```
hit-rate: X/10 (XX.X%)   avg precision@5: 0.XX
```

Exit code 0 if hit-rate ≥ 50%, exit code 1 otherwise.

Record the hit-rate and avg precision@5 numbers — you'll add them to the README in the next step.

- [ ] **Step 4: Update README.md with the baseline eval number**

Open `README.md`. Add a new section after `## Verify`:

```markdown
## Retrieval quality

```bash
npm run eval   # requires: docker compose up -d && POST /ingest on the corpus
```

Baseline over the 10-question sample corpus (`eval/dataset.jsonl`, `eval/sample-corpus/`):

| Metric | Score |
|--------|-------|
| Hit-rate | X/10 (XX.X%) |
| Avg precision@5 | 0.XX |

Run `npm run eval` after any retrieval change (chunk size, `k`, `MIN_SCORE`, embedding model) to confirm the number holds.
```

Fill in the actual numbers from Step 3.

- [ ] **Step 5: Update README.md status checklist**

In the `## Status` section of `README.md`, change:
```
- ⬜ GO-21b ingest · GO-21c retrieve · GO-21d cited generation · GO-21e UI · GO-21f deploy · GO-21g eval harness.
```
to:
```
- ✅ **GO-21b** — ingestion pipeline: chunk → embed (Voyage) → pgvector upsert, `POST /ingest`.
- ✅ **GO-21c** — retrieval: cosine top-k (HNSW) with score floor, `RetrievalService`.
- ✅ **GO-21d** — generation: Claude `claude-opus-4-8` with native citations, `POST /query`.
- ✅ **GO-21g** — retrieval eval harness: `npm run eval`, hit-rate + precision@k.
- ⬜ GO-21e chat UI · GO-21f deploy.
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: add eval baseline numbers and update status (GO-21g complete)"
```
