import { Logger } from '@nestjs/common';
import { EmbeddingProvider } from './embedding-provider.interface';

const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const DEFAULT_VOYAGE_MODEL = 'voyage-4-lite';

// Voyage rate-limits per minute (429 observed on the 4th back-to-back batch).
// 5 retries with 2s exponential backoff spans ~62s — one full rate window.
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

/**
 * Default embedding provider (TDD §2.1, D3): Voyage, default `voyage-4-lite`
 * (override via `VOYAGE_MODEL`). 1024 dims, pinned in the request via
 * `output_dimension` so the VECTOR(1024) schema contract holds even if a
 * model's default dimensionality differs.
 *
 * Talks to Voyage's REST API directly via fetch — no SDK. The provider-specific
 * request/response shape is fully contained here; nothing outside this file
 * knows the word "voyage" (rule `coding-standards.md`).
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dims = 1024;
  private readonly logger = new Logger(VoyageEmbeddingProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_VOYAGE_MODEL,
  ) {
    if (!apiKey) {
      throw new Error('VOYAGE_API_KEY is required for VoyageEmbeddingProvider');
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const started = Date.now();
    const res = await this.postWithRetry(
      JSON.stringify({
        input: texts,
        model: this.model,
        output_dimension: this.dims,
      }),
    );

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

  /** POST with retry on 429/5xx — exponential backoff, honoring Retry-After. */
  private async postWithRetry(body: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(VOYAGE_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      if (res.ok) return res;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        // Never log the body verbatim — it could echo the key; log status only.
        throw new Error(`Voyage embeddings request failed: ${res.status} ${res.statusText}`);
      }

      const retryAfterSec = Number(res.headers?.get?.('retry-after'));
      const delayMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
      this.logger.warn(
        `Voyage ${res.status} ${res.statusText}; retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delayMs)}ms`,
      );
      await this.sleep(delayMs);
    }
  }

  /** Separated so tests can stub the wait (no fake timers needed). */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

interface VoyageEmbeddingResponse {
  data: { index: number; embedding: number[] }[];
  usage?: { total_tokens: number };
}
