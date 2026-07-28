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

// Used only by the explicit, opt-in /query/general path — never the default
// grounded flow. The answer is the model's own knowledge, not the corpus.
const GENERAL_SYSTEM_PROMPT =
  'Answer the question from your general knowledge. This response is explicitly ' +
  'NOT drawn from the user document corpus — it is your own knowledge, offered ' +
  'because the corpus did not contain the answer. Be accurate and concise, and ' +
  'flag uncertainty rather than guessing.';

/**
 * Default GenerationProvider (D4): Claude with native citations. Each chunk
 * becomes a `document` content block with `citations: {enabled: true}`; the
 * API returns citations as structured spans mapped to a document_index —
 * verifiable, not model-formatted text.
 */
export class AnthropicGenerationProvider implements GenerationProvider {
  readonly name = 'anthropic';
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

  async generateGeneral(question: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: GENERAL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }],
    });

    let answer = '';
    for (const block of response.content) {
      if (block.type === 'text') answer += block.text;
    }
    this.logger.log('generated ungrounded general-knowledge answer (explicit opt-in, not from corpus)');
    return answer.trim();
  }
}
