import { encode, decode } from 'gpt-tokenizer';

/**
 * Token operations wrapped in one place so the tokenizer stays swappable (D9).
 * These govern chunk budgeting only — where consistency matters more than
 * matching a specific embedding model's exact tokenizer.
 */

export function countTokens(text: string): number {
  return encode(text).length;
}

/** Hard-split text into pieces of at most `maxTokens` tokens (last-resort guard). */
export function splitByTokens(text: string, maxTokens: number): string[] {
  const tokens = encode(text);
  if (tokens.length <= maxTokens) return [text];
  const pieces: string[] = [];
  for (let i = 0; i < tokens.length; i += maxTokens) {
    pieces.push(decode(tokens.slice(i, i + maxTokens)));
  }
  return pieces;
}

/** The trailing `n` tokens of text, decoded back to a string — the overlap seed. */
export function tailByTokens(text: string, n: number): string {
  const tokens = encode(text);
  if (tokens.length <= n) return text;
  return decode(tokens.slice(tokens.length - n));
}
