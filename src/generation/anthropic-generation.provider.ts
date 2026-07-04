import { Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { Citation, GenerationOutput, GenerationProvider } from './generation-provider.interface';

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT =
  'You answer strictly from the provided documents. Cite the documents you use. ' +
  'If the documents do not contain the answer, say you do not have that information ' +
  'in the corpus — never answer from outside knowledge.';

/**
 * Default GenerationProvider (D4): Claude with native citations. Each chunk
 * becomes a `document` content block with `citations: {enabled: true}`; the
 * API returns citations as structured spans mapped to a document_index —
 * verifiable, not model-formatted text.
 */
export class AnthropicGenerationProvider implements GenerationProvider {
  readonly supportsCitations = true;
  private readonly logger = new Logger(AnthropicGenerationProvider.name);

  constructor(
    private readonly client: Anthropic,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async generate(question: string, chunks: RetrievedChunk[]): Promise<GenerationOutput> {
    const documents: Anthropic.DocumentBlockParam[] = chunks.map((c) => ({
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: c.content },
      title: c.source,
      citations: { enabled: true },
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [...documents, { type: 'text', text: question }] }],
    });

    let answer = '';
    const citations: Citation[] = [];
    for (const block of response.content) {
      if (block.type !== 'text') continue;
      answer += block.text;
      for (const cit of block.citations ?? []) {
        if (cit.type === 'char_location') {
          citations.push({
            citedText: cit.cited_text,
            source: chunks[cit.document_index]?.source ?? cit.document_title ?? '',
            documentIndex: cit.document_index,
          });
        }
      }
    }

    this.logger.log(
      `generated answer over ${chunks.length} chunks with ${citations.length} citations`,
    );
    return { answer: answer.trim(), citations };
  }
}
