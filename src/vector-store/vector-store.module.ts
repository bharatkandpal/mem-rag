import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { PgVectorStore } from './pgvector.store';
import { VECTOR_STORE } from './vector-store.interface';

/**
 * Binds the VECTOR_STORE token to the pgvector impl (RAG-12/13), built over the
 * shared PG_POOL. Global so ingestion/retrieval inject the token without
 * re-importing. A different store would swap the factory body only.
 */
@Global()
@Module({
  providers: [
    {
      provide: VECTOR_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PgVectorStore(pool),
    },
  ],
  exports: [VECTOR_STORE],
})
export class VectorStoreModule {}
