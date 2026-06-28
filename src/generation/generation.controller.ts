import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { GenerationService, QueryResult } from './generation.service';

interface QueryBody {
  question?: unknown;
}

/**
 * POST /query { question } → cited answer (RAG-29). Thin: validates input and
 * delegates to the service.
 */
@Controller('query')
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}

  @Post()
  async query(@Body() body: QueryBody): Promise<QueryResult> {
    const question = body?.question;
    if (typeof question !== 'string' || question.trim() === '') {
      throw new BadRequestException('body.question (non-empty string) is required');
    }
    return this.generation.generate(question);
  }
}
