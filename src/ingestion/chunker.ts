import { countTokens, splitByTokens, tailByTokens } from './tokenizer';

export interface TextChunk {
  content: string;
  chunkIndex: number;
}

export interface ChunkOptions {
  /** Max tokens of new content per chunk (excludes the carried overlap seed). */
  chunkTokens: number;
  /** Tokens of the previous chunk carried into the next, for boundary context. */
  overlapTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkTokens: 512,
  overlapTokens: 64,
};

// Coarsest natural boundary first: paragraph → line → sentence → word.
const SEPARATORS = ['\n\n', '\n', '. ', ' '];

/**
 * Recursive structure-aware, token-budgeted chunker with overlap (D9).
 * Splits at the coarsest natural boundary that keeps pieces under budget, then
 * greedily packs them up to `chunkTokens` with `overlapTokens` of carried
 * context between consecutive chunks.
 */
export function chunk(
  text: string,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): TextChunk[] {
  if (text.trim() === '') return [];
  const atoms = segment(text, SEPARATORS, opts.chunkTokens);
  return pack(atoms, opts);
}

/**
 * Break text into atoms that each fit the token budget, descending the
 * separator hierarchy only as needed. Concatenating the atoms reproduces the
 * input (separators are preserved), so no content is dropped.
 */
function segment(text: string, separators: string[], maxTokens: number): string[] {
  if (text === '') return [];
  if (countTokens(text) <= maxTokens) return [text];
  if (separators.length === 0) return splitByTokens(text, maxTokens);

  const [sep, ...rest] = separators;
  const pieces = text.split(sep);
  const atoms: string[] = [];
  pieces.forEach((piece, i) => {
    // Reattach the separator to all but the last piece so concat == original.
    const withSep = i < pieces.length - 1 ? piece + sep : piece;
    if (withSep === '') return;
    atoms.push(...segment(withSep, rest, maxTokens));
  });
  return atoms;
}

/** Greedily pack atoms into chunks, seeding each with the previous chunk's tail. */
function pack(atoms: string[], opts: ChunkOptions): TextChunk[] {
  const { chunkTokens, overlapTokens } = opts;
  const chunks: TextChunk[] = [];
  let buf = '';        // full current chunk text (overlap seed + new content)
  let newTokens = 0;   // tokens of new content only (seed excluded from budget)
  let index = 0;

  const flush = () => {
    const content = buf.trim();
    if (content !== '') chunks.push({ content, chunkIndex: index++ });
  };

  for (const atom of atoms) {
    const atomTokens = countTokens(atom);
    if (newTokens > 0 && newTokens + atomTokens > chunkTokens) {
      const tail = buf; // capture before reset for the overlap seed
      flush();
      buf = overlapTokens > 0 ? tailByTokens(tail, overlapTokens) : '';
      newTokens = 0;
    }
    buf += atom;
    newTokens += atomTokens;
  }
  flush();
  return chunks;
}
