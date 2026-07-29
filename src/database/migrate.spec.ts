import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Migration,
  pendingMigrations,
  readMigrations,
} from './migrate';

/**
 * Unit tests for the migration-runner selection logic — the parts that decide
 * *which* files run and *in what order*, independent of a live database. The
 * transactional apply loop is exercised against a real Postgres in the smoke path,
 * not here.
 */
describe('readMigrations', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-migrations-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns .sql files sorted lexicographically (so numeric prefixes define order)', () => {
    // Written out of order to prove the sort, not filesystem enumeration order.
    writeFileSync(join(dir, '010_later.sql'), '');
    writeFileSync(join(dir, '002_second.sql'), '');
    writeFileSync(join(dir, '001_init.sql'), '');

    expect(readMigrations(dir).map((m) => m.version)).toEqual([
      '001_init.sql',
      '002_second.sql',
      '010_later.sql',
    ]);
  });

  it('ignores non-.sql files (READMEs, dotfiles, .sql.bak)', () => {
    writeFileSync(join(dir, '001_init.sql'), '');
    writeFileSync(join(dir, 'README.md'), '');
    writeFileSync(join(dir, '001_init.sql.bak'), '');

    expect(readMigrations(dir).map((m) => m.version)).toEqual(['001_init.sql']);
  });

  it('resolves an absolute path for each migration', () => {
    writeFileSync(join(dir, '001_init.sql'), '');
    expect(readMigrations(dir)[0].path).toBe(join(dir, '001_init.sql'));
  });
});

describe('pendingMigrations', () => {
  const mig = (version: string): Migration => ({ version, path: `/db/${version}` });
  const all = [mig('001_init.sql'), mig('002_add_col.sql'), mig('003_index.sql')];

  it('returns everything when nothing is applied (fresh database)', () => {
    expect(pendingMigrations(all, new Set()).map((m) => m.version)).toEqual([
      '001_init.sql',
      '002_add_col.sql',
      '003_index.sql',
    ]);
  });

  it('returns nothing when all are applied (schema up to date)', () => {
    const applied = new Set(all.map((m) => m.version));
    expect(pendingMigrations(all, applied)).toEqual([]);
  });

  it('skips applied versions and preserves apply order for the rest', () => {
    const applied = new Set(['001_init.sql']);
    expect(pendingMigrations(all, applied).map((m) => m.version)).toEqual([
      '002_add_col.sql',
      '003_index.sql',
    ]);
  });
});
