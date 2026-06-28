import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, extname, join, relative, sep } from 'path';

export interface LoadedDocument {
  /** Stable id derived from the path relative to the ingest root — drives idempotent upsert. */
  docId: string;
  /** Human-readable provenance for citations (same as docId for file sources). */
  source: string;
  text: string;
}

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt']);

/**
 * Loads a corpus from a file or directory into LoadedDocuments (RAG-14).
 * Handles `.md` / `.txt`; other files are skipped with a warning (PDF is a
 * later slice). doc_id is the path relative to the root, so re-ingesting the
 * same tree updates rows in place rather than duplicating them.
 */
export class DocumentLoader {
  private readonly logger = new Logger(DocumentLoader.name);

  async load(rootPath: string): Promise<LoadedDocument[]> {
    const stat = await fs.stat(rootPath); // throws if the path doesn't exist
    const isDir = stat.isDirectory();
    const base = isDir ? rootPath : dirname(rootPath);
    const files = isDir ? await this.walk(rootPath) : [rootPath];

    const docs: LoadedDocument[] = [];
    for (const file of files) {
      if (!SUPPORTED_EXTENSIONS.has(extname(file).toLowerCase())) {
        this.logger.warn(`skipping unsupported file: ${file}`);
        continue;
      }
      const text = await fs.readFile(file, 'utf8');
      // Normalise path separators so doc_id is stable across OSes.
      const docId = relative(base, file).split(sep).join('/');
      docs.push({ docId, source: docId, text });
    }
    return docs;
  }

  private async walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await this.walk(full)));
      else files.push(full);
    }
    return files;
  }
}
