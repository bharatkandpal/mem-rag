import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { IngestionService, IngestStats } from './ingestion.service';

interface IngestBody {
  path?: unknown;
}

/**
 * POST /ingest { path } → ingestion stats (RAG-17). Thin: validates input and
 * delegates to the service. No logic lives here.
 */
@Controller('ingest')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post()
  async ingest(@Body() body: IngestBody): Promise<IngestStats> {
    const path = body?.path;
    if (typeof path !== 'string' || path.trim() === '') {
      throw new BadRequestException('body.path (non-empty string) is required');
    }
    return this.ingestion.ingest(path);
  }
}
