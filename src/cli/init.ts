import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The scaffold generator (GO-21j / RAG-66d, embeddable-scaffold-guide.md §4).
 * Writes wiring + config into a host project so it can `import { RagModule }
 * from 'rag-knowledge-store'` — the generator never copies pipeline logic,
 * only files that import the package (rule: reuse discipline, coding-standards.md).
 */

/** One file the generator can write, relative to the target directory. */
export interface ScaffoldFile {
  relativePath: string;
  content: string;
}

export interface InitOptions {
  /** Directory to scaffold into. */
  target: string;
  /** Overwrite files that already exist (default: skip them). */
  force: boolean;
  /** Report what would happen without touching the filesystem. */
  dryRun: boolean;
}

export type FileOutcome = 'written' | 'skipped' | 'would-write';

export interface InitFileResult {
  relativePath: string;
  outcome: FileOutcome;
}

export interface InitResult {
  target: string;
  files: InitFileResult[];
}

const HOST_RAG_MODULE = `import { Module } from '@nestjs/common';
import { RagModule } from 'rag-knowledge-store';

/**
 * Host wiring for the embedded RAG capability (written by 'rag init').
 * Add HostRagModule to your AppModule's imports — that's the whole
 * integration; every option below is optional and falls back to env
 * (see .env.rag.example). Full override surface (all optional):
 * RagModule.forRoot({ embeddingProvider, generationProvider, k, minScore, http }).
 */
@Module({
  imports: [
    RagModule.forRoot({
      // http: true, // also register POST /ingest, /query, /query/general
    }),
  ],
})
export class HostRagModule {}
`;

const ENV_RAG_EXAMPLE = `# Copy to .env (or merge into your existing one) and fill in.
# Written by 'rag init' — RagModule.forRoot() reads these keys env-first;
# every one of them is also an explicit code-level override on forRoot().
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
DATABASE_URL=postgresql://rag:rag@localhost:5433/rag

# EMBEDDING_PROVIDER — options: voyage | transformers
EMBEDDING_PROVIDER=voyage
VOYAGE_MODEL=voyage-4-lite

RETRIEVAL_K=5
MIN_SCORE=0.3

# GENERATION_PROVIDER — options: anthropic | openai-compatible
GENERATION_PROVIDER=anthropic
GENERATION_MODEL=claude-opus-4-8

# --- dims trap ---
# db/rag/001_init.sql is VECTOR(1024), pinned to Voyage's output_dimension.
# Swapping to a non-1024 embedding model (via forRoot({ embeddingProvider }))
# means editing that column AND re-ingesting from scratch — embeddings from
# different models are not interchangeable.
`;

const DOCKER_COMPOSE_RAG = `# Optional, self-contained Postgres + pgvector for local dev (written by
# 'rag init'). Bring your own Postgres in production; this just gets you one
# locally with zero setup:
#
#   docker compose -f docker-compose.rag.yml up -d
#
# Port 5433 (not 5432) so it won't collide with a Postgres you already run;
# DATABASE_URL in .env.rag.example already points at it.
services:
  rag-db:
    image: pgvector/pgvector:0.8.1-pg16
    environment:
      POSTGRES_USER: rag
      POSTGRES_PASSWORD: rag
      POSTGRES_DB: rag
    ports:
      - '5433:5432'
    volumes:
      - rag_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U rag -d rag']
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  rag_pgdata:
`;

const DB_RAG_INIT_SQL = `-- Schema for the embedded RAG capability (written by 'rag init').
-- VECTOR(1024) is pinned to Voyage's default output_dimension — swapping to a
-- non-1024 embedding model means editing this column AND re-ingesting from
-- scratch (see the dims-trap note in .env.rag.example).
--
-- Apply it with the migration runner rag-knowledge-store already ships
-- (idempotent, tracks applied versions):
--   MIGRATIONS_DIR=db/rag DATABASE_URL=... \\
--     node node_modules/rag-knowledge-store/dist/database/migrate.js
-- ...or by hand with psql / your own migration tool — this file has no
-- dependency on that runner (every statement is IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunks (
  id          BIGSERIAL PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  source      TEXT NOT NULL,
  chunk_index INT  NOT NULL,
  content     TEXT NOT NULL,
  embedding   VECTOR(1024) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);
`;

/**
 * The file set 'rag init' writes (embeddable-scaffold-guide.md §4). Pure data
 * — no filesystem access — so it's the single source of truth for "what does
 * init write," shared by the real write path and --dry-run's preview.
 */
export function scaffoldFiles(): ScaffoldFile[] {
  return [
    { relativePath: 'src/rag/rag.module.ts', content: HOST_RAG_MODULE },
    { relativePath: '.env.rag.example', content: ENV_RAG_EXAMPLE },
    { relativePath: 'docker-compose.rag.yml', content: DOCKER_COMPOSE_RAG },
    { relativePath: 'db/rag/001_init.sql', content: DB_RAG_INIT_SQL },
  ];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the scaffold into options.target. Idempotent: a file that already
 * exists is skipped unless --force, so a host's own edits are never silently
 * clobbered. --dry-run reports the same per-file outcome shape with no
 * filesystem writes at all.
 */
export async function runInit(options: InitOptions): Promise<InitResult> {
  const files: InitFileResult[] = [];
  for (const file of scaffoldFiles()) {
    const absPath = join(options.target, file.relativePath);
    const exists = await pathExists(absPath);
    if (exists && !options.force) {
      files.push({ relativePath: file.relativePath, outcome: 'skipped' });
      continue;
    }
    if (options.dryRun) {
      files.push({ relativePath: file.relativePath, outcome: 'would-write' });
      continue;
    }
    await fs.mkdir(dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, file.content, 'utf8');
    files.push({ relativePath: file.relativePath, outcome: 'written' });
  }
  return { target: options.target, files };
}
