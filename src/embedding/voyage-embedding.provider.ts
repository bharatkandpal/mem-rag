import { Logger } from '@nestjs/common';
import { EmbeddingProvider } from './embedding-provider.interface';

const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

/**
 * Default embedding provider (TDD §2.1, D3): Voyage `voyage-3`, 1024 dims.
 *
 * Talks to Voyage's REST API directly via fetch — no SDK. The provider-specific
 * request/response shape is fully contained here; nothing outside this file
 * knows the word "voyage" (rule `coding-standards.md`).
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dims = 1024;
  private readonly model = 'voyage-3';
  private readonly logger = new Logger(VoyageEmbeddingProvider.name);

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error('VOYAGE_API_KEY is required for VoyageEmbeddingProvider');
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const started = Date.now();
    const res = await fetch(VOYAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });

    if (!res.ok) {
      // Never log the body verbatim — it could echo the key; log status only.
      throw new Error(`Voyage embeddings request failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as VoyageEmbeddingResponse;
    // Voyage returns objects with an `index`; sort to guarantee input order.
    const vectors = body.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    this.logger.log(
      `embedded ${texts.length} texts (${body.usage?.total_tokens ?? '?'} tokens) in ${Date.now() - started}ms`,
    );
    return vectors;
  }
}

interface VoyageEmbeddingResponse {
  data: { index: number; embedding: number[] }[];
  usage?: { total_tokens: number };
}
