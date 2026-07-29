import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
} from './embedding-provider.interface';
import { VoyageEmbeddingProvider } from './voyage-embedding.provider';
import { TransformersEmbeddingProvider } from './transformers-embedding.provider';

export type EmbeddingProviderName = 'voyage' | 'transformers';

/**
 * Builds the `EmbeddingProvider` bound to `EMBEDDING_PROVIDER` (RAG-11). `override`
 * is the RAG-66c `RagModule.forRoot({ embeddingProvider })` seam: a concrete
 * `EmbeddingProvider` instance is used as-is (a host supplying its own adapter);
 * a name (`'voyage' | 'transformers'`) picks that impl instead of reading env;
 * `undefined` falls back to `EMBEDDING_PROVIDER` env, exactly as before RAG-66c.
 * The single place that knows the concrete impls — call sites depend on the
 * interface alone.
 */
export function resolveEmbeddingProvider(
  config: ConfigService,
  override?: EmbeddingProviderName | EmbeddingProvider,
): EmbeddingProvider {
  if (override && typeof override === 'object') return override;
  const name = override ?? config.get<string>('EMBEDDING_PROVIDER', 'voyage');
  switch (name) {
    case 'voyage':
      return new VoyageEmbeddingProvider(
        config.get<string>('VOYAGE_API_KEY', ''),
        config.get<string>('VOYAGE_MODEL'),
      );
    // Local, in-process transformers.js — no key, no network, self-hostable
    // (RAG-56). Default model is 1024-dim to match the VECTOR(1024) schema.
    case 'transformers':
      return new TransformersEmbeddingProvider(config.get<string>('EMBEDDING_MODEL'));
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER: ${name}`);
  }
}

/**
 * Binds the configured EmbeddingProvider (RAG-11). Selection is env-driven via
 * EMBEDDING_PROVIDER so call sites depend on the interface alone. Global so
 * ingestion and retrieval can inject the token without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmbeddingProvider =>
        resolveEmbeddingProvider(config),
    },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class EmbeddingModule {
  /**
   * Same module, with an explicit provider override (RAG-66c). `global: true`
   * is set explicitly on the returned `DynamicModule` — the class's own
   * `@Global()` decorator only applies to the plain (non-`register`) usage the
   * standalone app makes; a dynamically-returned module must opt back in so
   * Ingestion/Retrieval (which never import EmbeddingModule directly) can still
   * resolve EMBEDDING_PROVIDER by token.
   */
  static register(override?: EmbeddingProviderName | EmbeddingProvider): DynamicModule {
    return {
      module: EmbeddingModule,
      global: true,
      providers: [
        {
          provide: EMBEDDING_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: ConfigService): EmbeddingProvider =>
            resolveEmbeddingProvider(config, override),
        },
      ],
      exports: [EMBEDDING_PROVIDER],
    };
  }
}
