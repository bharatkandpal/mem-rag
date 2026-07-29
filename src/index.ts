/**
 * Public library surface for embedding RAG into a host project (GO-21j / RAG-66).
 * A host installs the package and imports `RagModule` (plus the services and the
 * adapter seams for custom providers) from here — nothing outside this barrel is
 * part of the supported API. The `rag init` generator (RAG-66d) writes host
 * wiring that imports from this entry point.
 */

// The one import a host adds — composes the pipeline, re-exports the services.
export { RagModule } from './rag.module';

// The three pipeline services, injectable in the host once RagModule is imported.
export { IngestionService } from './ingestion/ingestion.service';
export { RetrievalService } from './retrieval/retrieval.service';
export { GenerationService } from './generation/generation.service';
export type { QueryResult } from './generation/generation.service';

// Adapter seams + their tokens — for a host that supplies its own provider.
export { EMBEDDING_PROVIDER } from './embedding/embedding-provider.interface';
export type { EmbeddingProvider } from './embedding/embedding-provider.interface';

export { VECTOR_STORE } from './vector-store/vector-store.interface';
export type {
  VectorStore,
  ChunkInput,
  RetrievedChunk,
} from './vector-store/vector-store.interface';

export { GENERATION_PROVIDER } from './generation/generation-provider.interface';
export type {
  GenerationProvider,
  Citation,
  GenerationOutput,
} from './generation/generation-provider.interface';
