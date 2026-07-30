import { Logger } from '@nestjs/common';
import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { Citation, GenerationOutput, GenerationProvider } from './generation-provider.interface';

// A citation is only credited when the matched run is at least this many
// words long AND covers at least this fraction of the sentence's words.
// Both bars exist to keep precision high: a short/loose match (a stray "the
// system uses" appearing in an unrelated chunk) must never be credited as
// support for a claim. Missing a real citation is safe (the sentence just
// renders uncited); crediting a false one is not — so these defaults are
// deliberately conservative.
const DEFAULT_MIN_MATCH_WORDS = 6;
const DEFAULT_MIN_OVERLAP_RATIO = 0.6;

/**
 * Wraps any other `GenerationProvider` and independently verifies which
 * sentences of its answer are actually supported by the retrieved chunks —
 * it never trusts the wrapped provider's own claims (there are none to trust;
 * the wrapped provider is typically `OpenAICompatibleGenerationProvider`,
 * which always returns `citations: []`). For each answer sentence, it finds
 * the chunk with the longest contiguous run of shared words; a citation is
 * only emitted when that run clears both `minMatchWords` and
 * `minOverlapRatio` — otherwise the sentence renders uncited, never invented.
 *
 * `citedText` is the exact substring sliced from the matching chunk's own
 * `content` (not from the answer) — the same "quote from the source
 * document" semantics as Claude's native `char_location` citations (rule
 * `ai-and-secrets.md`: a citation is a capability, never a fabrication; this
 * is what makes `supportsCitations: true` an honest claim here — every
 * citation is checked against real source text, not requested from or
 * trusted from the model).
 *
 * Limits, stated plainly: this is lexical overlap, not semantic understanding
 * — a paraphrased sentence that shares few exact words with its source chunk
 * will be missed (a false negative, i.e. renders uncited), never falsely
 * credited to the wrong chunk. It has no notion of *why* two spans match,
 * unlike Claude's citations which are produced by the model during decoding.
 */
export class CitationVerifyingGenerationProvider implements GenerationProvider {
  readonly name: string;
  readonly supportsCitations = true;
  private readonly logger = new Logger(CitationVerifyingGenerationProvider.name);

  constructor(
    private readonly inner: GenerationProvider,
    private readonly minMatchWords: number = DEFAULT_MIN_MATCH_WORDS,
    private readonly minOverlapRatio: number = DEFAULT_MIN_OVERLAP_RATIO,
  ) {
    this.name = `citation-verifying(${inner.name})`;
  }

  async generate(question: string, chunks: RetrievedChunk[]): Promise<GenerationOutput> {
    const { answer } = await this.inner.generate(question, chunks);
    const citations = this.verify(answer, chunks);
    this.logger.log(
      `verified ${citations.length} citation(s) over ${chunks.length} chunks (inner: ${this.inner.name})`,
    );
    return { answer, citations };
  }

  // The ungrounded opt-in path has no chunks to verify against — no citation
  // concept applies here regardless of which provider is wrapped. Delegate as-is.
  async generateGeneral(question: string): Promise<string> {
    return this.inner.generateGeneral(question);
  }

  private verify(answer: string, chunks: RetrievedChunk[]): Citation[] {
    const chunkTokens = chunks.map((c) => tokenize(c.content));
    const citations: Citation[] = [];

    for (const sentence of splitSentences(answer)) {
      const sentenceTokens = tokenize(sentence);
      if (sentenceTokens.length === 0) continue;

      let best: { documentIndex: number; run: CommonRun } | null = null;
      for (let i = 0; i < chunkTokens.length; i++) {
        const run = longestCommonRun(sentenceTokens, chunkTokens[i]);
        if (!best || run.length > best.run.length) best = { documentIndex: i, run };
      }
      if (!best || best.run.length === 0) continue;

      const ratio = best.run.length / sentenceTokens.length;
      if (best.run.length < this.minMatchWords || ratio < this.minOverlapRatio) continue;

      const chunk = chunks[best.documentIndex];
      const matched = best.run.tokensB;
      const citedText = chunk.content.slice(
        matched[0].start,
        matched[matched.length - 1].end,
      );
      citations.push({ citedText, source: chunk.source, documentIndex: best.documentIndex });
    }
    return citations;
  }
}

// --- pure matching helpers ---------------------------------------------------

interface PositionedToken {
  /** Lowercased, for order-preserving equality comparison. */
  word: string;
  start: number;
  end: number;
}

/** Word tokens with their character offsets in the original (untouched) string. */
function tokenize(text: string): PositionedToken[] {
  const tokens: PositionedToken[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/** Naive sentence/line splitter — sufficient for the short, context-constrained answers this wraps. */
function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

interface CommonRun {
  length: number;
  tokensB: PositionedToken[];
}

/** Longest contiguous run of tokens in `a` that also appears contiguously (same order) in `b`. */
function longestCommonRun(a: PositionedToken[], b: PositionedToken[]): CommonRun {
  let bestLen = 0;
  let bestBStart = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let len = 0;
      while (i + len < a.length && j + len < b.length && a[i + len].word === b[j + len].word) {
        len++;
      }
      if (len > bestLen) {
        bestLen = len;
        bestBStart = j;
      }
    }
  }
  return { length: bestLen, tokensB: b.slice(bestBStart, bestBStart + bestLen) };
}
