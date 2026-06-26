import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
} from './embedding-provider.interface';
import { VoyageEmbeddingProvider } from './voyage-embedding.provider';

/**
 * Binds the configured EmbeddingProvider (RAG-11). The factory is the only
 * place that knows the concrete impls; selection is env-driven via
 * EMBEDDING_PROVIDER so call sites depend on the interface alone. Global so
 * ingestion and retrieval can inject the token without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmbeddingProvider => {
        const name = config.get<string>('EMBEDDING_PROVIDER', 'voyage');
        switch (name) {
          case 'voyage':
            return new VoyageEmbeddingProvider(
              config.get<string>('VOYAGE_API_KEY', ''),
            );
          // Alt providers (e.g. openai) plug in here to prove the seam — RAG-10+.
          default:
            throw new Error(`Unknown EMBEDDING_PROVIDER: ${name}`);
        }
      },
    },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class EmbeddingModule {}
