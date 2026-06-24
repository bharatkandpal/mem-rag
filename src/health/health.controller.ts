import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

interface HealthReport {
  status: 'ok' | 'degraded';
  db: boolean;
  pgvector: boolean;
}

@Controller('healthz')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async check(): Promise<HealthReport> {
    let db = false;
    let pgvector = false;
    try {
      await this.pool.query('SELECT 1');
      db = true;
      const ext = await this.pool.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'",
      );
      pgvector = (ext.rowCount ?? 0) > 0;
    } catch {
      // flags stay false → reported as degraded below
    }

    const report: HealthReport = {
      status: db && pgvector ? 'ok' : 'degraded',
      db,
      pgvector,
    };

    if (report.status !== 'ok') {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
