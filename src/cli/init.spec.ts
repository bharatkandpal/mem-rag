import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InitOptions, runInit, scaffoldFiles } from './init';

/** Exercises the generator against a real temp directory tree (same pattern as
 * DocumentLoader's spec — a real filesystem, not a mocked one). */
describe('rag init (RAG-66d)', () => {
  let target: string;

  beforeEach(async () => {
    target = await fs.mkdtemp(join(tmpdir(), 'rag-init-'));
  });
  afterEach(async () => fs.rm(target, { recursive: true, force: true }));

  const optionsFor = (overrides: Partial<InitOptions> = {}): InitOptions => ({
    target,
    force: false,
    dryRun: false,
    ...overrides,
  });

  it('writes every scaffold file into an empty target, nested dirs included', async () => {
    const result = await runInit(optionsFor());

    const expected = scaffoldFiles().map((f) => f.relativePath);
    expect(result.files.map((f) => f.relativePath).sort()).toEqual(expected.sort());
    expect(result.files.every((f) => f.outcome === 'written')).toBe(true);

    for (const file of scaffoldFiles()) {
      const written = await fs.readFile(join(target, file.relativePath), 'utf8');
      expect(written).toBe(file.content);
    }
  });

  it('is idempotent: re-running skips existing files and touches nothing on disk', async () => {
    await runInit(optionsFor());
    const before = await fs.readFile(join(target, '.env.rag.example'), 'utf8');

    // Prove skip is real, not accidental — mutate a file, re-run without --force,
    // and confirm the mutation survives (a silent overwrite would erase it).
    await fs.writeFile(join(target, '.env.rag.example'), 'user edited this\n');

    const result = await runInit(optionsFor());
    expect(result.files.every((f) => f.outcome === 'skipped')).toBe(true);

    const after = await fs.readFile(join(target, '.env.rag.example'), 'utf8');
    expect(after).toBe('user edited this\n');
    expect(after).not.toBe(before);
  });

  it('--force overwrites existing files', async () => {
    await runInit(optionsFor());
    await fs.writeFile(join(target, '.env.rag.example'), 'user edited this\n');

    const result = await runInit(optionsFor({ force: true }));
    expect(result.files.every((f) => f.outcome === 'written')).toBe(true);

    const content = await fs.readFile(join(target, '.env.rag.example'), 'utf8');
    expect(content).not.toBe('user edited this\n');
  });

  it('--dry-run writes nothing to disk', async () => {
    const result = await runInit(optionsFor({ dryRun: true }));
    expect(result.files.every((f) => f.outcome === 'would-write')).toBe(true);

    const entries = await fs.readdir(target);
    expect(entries).toEqual([]); // target is still empty — no files, no dirs
  });

  it('--dry-run over an existing file reports skipped, not would-write (force still governs)', async () => {
    await runInit(optionsFor());
    const result = await runInit(optionsFor({ dryRun: true }));
    expect(result.files.every((f) => f.outcome === 'skipped')).toBe(true);
  });
});
