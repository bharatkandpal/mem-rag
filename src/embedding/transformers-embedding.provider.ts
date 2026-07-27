import { Logger } from '@nestjs/common';
import { EmbeddingProvider } from './embedding-provider.interface';

/** The slice of a transformers.js feature-extraction pipeline we depend on. */
export type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/** Loads (downloading on first call) a feature-extraction pipeline for `model`. */
export type PipelineLoader = (model: string) => Promise<FeatureExtractor>;

const DEFAULT_MODEL = 'Xenova/bge-large-en-v1.5';

// bge-large-en-v1.5 emits 1024-dim vectors — matches the VECTOR(1024) schema, so
// this is a config-only swap (no migration). A different-dimension model here
// would fail the startup dims assertion (see EmbeddingProvider.dims): change this
// constant AND migrate + re-ingest, never one without the other (the dims trap).
const MODEL_DIMS = 1024;

/**
 * The real loader — lazily `import()`s the ESM-only `@huggingface/transformers`
 * (TS→require of its bundled `.cjs`; Node 22.12+ handles it). Kept off the module
 * top-level and behind this injectable seam so unit tests supply a fake loader
 * and never pull the heavy runtime or download weights.
 */
const defaultLoader: PipelineLoader = async (model) => {
  const { env, pipeline } = await import('@huggingface/transformers');
  // Relocate the on-disk weight cache when TRANSFORMERS_CACHE is set. Its default
  // lives under node_modules, which is read-only for the nonroot user in the
  // distroless container — so the key-free container run (docker-compose.local.yml)
  // points this at a writable, mounted volume. Unset (host/dev) keeps the default.
  const cacheDir = process.env.TRANSFORMERS_CACHE;
  if (cacheDir) env.cacheDir = cacheDir;
  // `dtype: 'q8'` picks the quantized weights: smaller download, faster CPU
  // inference. Quality lever — retrieval quality is measured by the eval (RAG-56e).
  const extractor = await pipeline('feature-extraction', model, { dtype: 'q8' });
  return extractor as unknown as FeatureExtractor;
};

/**
 * Local, in-process embedding provider (RAG-56, TDD §2.1): runs a transformers.js
 * model on the CPU — no API key, no network, no per-call cost or rate limit, the
 * self-hostable story Voyage can't give. Default `Xenova/bge-large-en-v1.5`
 * (override via `EMBEDDING_MODEL`); mean-pooled + L2-normalized so vectors are
 * cosine-ready, the same contract pgvector's cosine search expects.
 *
 * Nothing outside this file names transformers.js (rule `coding-standards.md`).
 */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly dims = MODEL_DIMS;
  private readonly logger = new Logger(TransformersEmbeddingProvider.name);
  private extractor: Promise<FeatureExtractor> | null = null;

  constructor(
    private readonly model: string = DEFAULT_MODEL,
    private readonly load: PipelineLoader = defaultLoader,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const started = Date.now();
    const extract = await this.getExtractor();
    const output = await extract(texts, { pooling: 'mean', normalize: true });
    const vectors = output.tolist();

    this.logger.log(`embedded ${texts.length} texts locally in ${Date.now() - started}ms`);
    return vectors;
  }

  /** Load the pipeline once and cache the promise — first call downloads weights. */
  private getExtractor(): Promise<FeatureExtractor> {
    if (!this.extractor) {
      this.logger.log(`loading local embedding model ${this.model} (first call downloads weights)`);
      this.extractor = this.load(this.model);
    }
    return this.extractor;
  }
}
