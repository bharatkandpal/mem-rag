import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DocumentLoader } from './document-loader';

/** Exercises the loader against a real temp directory tree. */
describe('DocumentLoader', () => {
  let root: string;
  const loader = new DocumentLoader();

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'rag-loader-'));
  });
  afterEach(async () => fs.rm(root, { recursive: true, force: true }));

  it('loads .md and .txt and skips unsupported files', async () => {
    await fs.writeFile(join(root, 'a.md'), '# A');
    await fs.writeFile(join(root, 'b.txt'), 'B');
    await fs.writeFile(join(root, 'c.pdf'), 'binary');

    const docs = await loader.load(root);
    expect(docs.map((d) => d.docId).sort()).toEqual(['a.md', 'b.txt']);
  });

  it('derives a stable, slash-normalised docId from the relative path', async () => {
    await fs.mkdir(join(root, 'nested'));
    await fs.writeFile(join(root, 'nested', 'deep.md'), 'content');

    const docs = await loader.load(root);
    expect(docs).toHaveLength(1);
    expect(docs[0].docId).toBe('nested/deep.md');
    expect(docs[0].source).toBe('nested/deep.md');
    expect(docs[0].text).toBe('content');
  });

  it('accepts a single file path', async () => {
    const file = join(root, 'solo.txt');
    await fs.writeFile(file, 'hello');

    const docs = await loader.load(file);
    expect(docs).toEqual([{ docId: 'solo.txt', source: 'solo.txt', text: 'hello' }]);
  });

  it('throws when the path does not exist', async () => {
    await expect(loader.load(join(root, 'missing'))).rejects.toThrow();
  });
});
