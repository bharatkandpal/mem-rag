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
    return this.generation.generate(requireQuestion(body));
  }

  /**
   * POST /query/general { question } → explicit, opt-in ungrounded answer from
   * the model's general knowledge, NOT the corpus (`grounded: false`, no
   * citations). Separate route so the default /query keeps its abstain
   * guarantee (D5); only invoked when the user asks for a general answer after
   * an abstain. The UI colour-codes the result as non-corpus.
   */
  @Post('general')
  async general(@Body() body: QueryBody): Promise<QueryResult> {
    return this.generation.generateGeneral(requireQuestion(body));
  }
}

function requireQuestion(body: QueryBody): string {
  const question = body?.question;
  if (typeof question !== 'string' || question.trim() === '') {
    throw new BadRequestException('body.question (non-empty string) is required');
  }
  return question;
}
