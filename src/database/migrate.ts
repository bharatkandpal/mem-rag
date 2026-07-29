#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * Migration runner (RAG-46) — the single schema authority for both fresh local
 * runs and deploy, replacing the initdb-only bootstrap (which never re-runs on an
 * existing volume and doesn't cover managed Postgres / k8s). A standalone entrypoint
 * on purpose: `npm run migrate`, a one-shot compose `migrate` service, or a k8s Job /
 * init-container (RAG-64) all invoke `node dist/database/migrate.js` — no HTTP, no
 * NestFactory, just a pg pool.
 *
 * Applies every `db/migrations/00X_*.sql` not yet recorded in the `schema_migrations`
 * ledger, in lexicographic order, each in its own transaction (file + ledger insert
 * commit together, so a failed migration leaves no partial version recorded). Files
 * are idempotent (IF NOT EXISTS), but the ledger is what makes this a real runner:
 * an applied migration is skipped, and the applied set is auditable.
 */

/** DI-free ledger table name; also the table this runner owns. */
export const MIGRATIONS_TABLE = 'schema_migrations';

/** Baked into the image (Dockerfile COPY db/migrations) and resolvable from repo
 * root for `npm run migrate`. __dirname is dist/database → ../../ is the app root.
 * Overridable for tests / non-standard layouts. */
export const migrationsDir = (): string =>
  process.env.MIGRATIONS_DIR ?? join(__dirname, '..', '..', 'db', 'migrations');

export interface Migration {
  /** Filename, e.g. `001_init.sql` — the ledger key and sort key. */
  version: string;
  path: string;
}

/** Read `.sql` migrations from `dir`, sorted lexicographically by filename so the
 * zero-padded numeric prefix defines apply order. Non-`.sql` files are ignored. */
export function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((version) => ({ version, path: join(dir, version) }));
}

/** The migrations not yet in the applied set, preserving apply order. */
export function pendingMigrations(
  all: Migration[],
  applied: ReadonlySet<string>,
): Migration[] {
  return all.filter((m) => !applied.has(m.version));
}

async function ensureLedger(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       version    TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
}

async function appliedVersions(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ version: string }>(
    `SELECT version FROM ${MIGRATIONS_TABLE}`,
  );
  return new Set(rows.map((r) => r.version));
}

/** Apply one migration and record it in the same transaction, so the file's DDL and
 * its ledger entry commit atomically — a mid-migration failure rolls back both. */
async function applyOne(pool: Pool, m: Migration): Promise<void> {
  const sql = readFileSync(m.path, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (version) VALUES ($1)`,
      [m.version],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Orchestration: ensure the ledger, apply every pending migration in order. */
export async function migrate(pool: Pool, logger: Logger): Promise<Migration[]> {
  await ensureLedger(pool);
  const applied = await appliedVersions(pool);
  const pending = pendingMigrations(readMigrations(migrationsDir()), applied);
  if (pending.length === 0) {
    logger.log('schema up to date — no pending migrations');
    return [];
  }
  logger.log(`applying ${pending.length} migration(s): ${pending.map((m) => m.version).join(', ')}`);
  for (const m of pending) {
    await applyOne(pool, m);
    logger.log(`applied ${m.version}`);
  }
  return pending;
}

async function main(): Promise<void> {
  const logger = new Logger('Migrate');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  const pool = new Pool({ connectionString });
  try {
    await migrate(pool, logger);
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly (node dist/database/migrate.js), not when imported
// by the unit test.
if (require.main === module) {
  main().catch((err: unknown) => {
    new Logger('Migrate').error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
