import { Logger } from '@nestjs/common';
import { RetrievedChunk } from '../vector-store/vector-store.interface';
import { GenerationOutput, GenerationProvider } from './generation-provider.interface';

const MAX_TOKENS = 1024;

const SYSTEM_PROMPT =
  'You answer strictly from the provided context. ' +
  'If the context does not contain the answer, say you do not have that information ' +
  'in the corpus — never answer from outside knowledge.';

// Used only by the explicit, opt-in /query/general path — never the default
// grounded flow. The answer is the model's own knowledge, not the corpus.
const GENERAL_SYSTEM_PROMPT =
  'Answer the question from your general knowledge. This response is explicitly ' +
  'NOT drawn from the user document corpus — it is your own knowledge, offered ' +
  'because the corpus did not contain the answer. Be accurate and concise, and ' +
  'flag uncertainty rather than guessing.';

/**
 * Proves the generation seam (add-adapter skill): any OpenAI-compatible
 * chat-completions endpoint plugs in unchanged — OpenAI itself, or a
 * self-hosted server exposing the same API (Ollama, LM Studio, vLLM,
 * text-generation-webui). "Even a small local model" is satisfied by pointing
 * GENERATION_BASE_URL at a local Ollama instance and GENERATION_MODEL at
 * e.g. `llama3.2:1b` — no code changes, just env config (GENERATION_PROVIDER
 * factory, generation.module.ts).
 *
 * No native citations API exists on this surface, so `supportsCitations` is
 * false and citations are always `[]` — never faked (see the interface doc).
 * Chunks are inlined as numbered context in the user message instead of
 * verifiable document blocks.
 */
export class OpenAICompatibleGenerationProvider implements GenerationProvider {
  readonly supportsCitations = false;
  private readonly logger = new Logger(OpenAICompatibleGenerationProvider.name);

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {
    if (!baseUrl) {
      throw new Error('GENERATION_BASE_URL is required for the openai-compatible provider');
    }
    if (!model) {
      throw new Error('GENERATION_MODEL is required for the openai-compatible provider');
    }
  }

  async generate(question: string, chunks: RetrievedChunk[]): Promise<GenerationOutput> {
    const context = chunks.map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`).join('\n\n');

    const started = Date.now();
    const answer = await this.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ]);

    this.logger.log(`generated answer over ${chunks.length} chunks in ${Date.now() - started}ms`);
    return { answer, citations: [] };
  }

  async generateGeneral(question: string): Promise<string> {
    const answer = await this.chat([
      { role: 'system', content: GENERAL_SYSTEM_PROMPT },
      { role: 'user', content: question },
    ]);
    this.logger.log('generated ungrounded general-knowledge answer (explicit opt-in, not from corpus)');
    return answer;
  }

  private async chat(messages: { role: string; content: string }[]): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, max_tokens: MAX_TOKENS, messages }),
    });

    if (!res.ok) {
      // Never log the body verbatim — it could echo an API key; log status only.
      throw new Error(`Generation request failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as OpenAICompatibleChatResponse;
    return (body.choices?.[0]?.message?.content ?? '').trim();
  }
}

interface OpenAICompatibleChatResponse {
  choices?: { message?: { content?: string } }[];
}
