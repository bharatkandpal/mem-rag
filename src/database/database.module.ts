import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

/** DI token for the shared Postgres connection pool. */
export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool =>
        new Pool({ connectionString: config.get<string>('DATABASE_URL') }),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
