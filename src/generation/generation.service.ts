import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Anthropic from '@anthropic-ai/sdk';
import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { RetrievalService } from '../retrieval/retrieval.service';

/** DI token for the Anthropic client (so it can be mocked in tests). */
export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 1024;
const ABSTAIN_MESSAGE = "I don't have that information in the corpus.";

const SYSTEM_PROMPT =
  'You answer strictly from the provided documents. Cite the documents you use. ' +
  'If the documents do not contain the answer, say you do not have that information ' +
  'in the corpus — never answer from outside knowledge.';

export interface Citation {
  citedText: string;
  source: string; // provenance of the chunk the citation points at
  documentIndex: number;
}

export interface QueryResult {
  answer: string;
  citations: Citation[];
  chunks: RetrievedChunk[];
  abstained: boolean;
}

/**
 * Generation with native citations (RAG-25-30, D4). Retrieves, then asks Claude
 * to answer over the retrieved chunks passed as `document` blocks with citations
 * enabled. Abstains without calling the model when retrieval is empty (D5) —
 * grounding is the whole product.
 */
@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);
  private readonly model: string;

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic,
    private readonly retrieval: RetrievalService,
    config: ConfigService,
  ) {
    this.model = config.get<string>('GENERATION_MODEL', DEFAULT_MODEL);
  }

  async generate(question: string): Promise<QueryResult> {
    const chunks = await this.retrieval.retrieve(question);

    // Abstain on empty retrieval — never free-generate (D5).
    if (chunks.length === 0) {
      this.logger.log('abstaining: no chunks cleared the score floor');
      return { answer: ABSTAIN_MESSAGE, citations: [], chunks: [], abstained: true };
    }

    // Each chunk becomes a citable document; document_index maps back to chunks[].
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

    this.logger.log(`generated answer over ${chunks.length} chunks with ${citations.length} citations`);
    return { answer: answer.trim(), citations, chunks, abstained: false };
  }
}
