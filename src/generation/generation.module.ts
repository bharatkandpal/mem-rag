import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { GenerationController } from './generation.controller';
import { ANTHROPIC_CLIENT, GenerationService } from './generation.service';

/**
 * Generation feature module (RAG-25-30). Imports RetrievalModule to consume
 * RetrievalService, and binds the Anthropic client from ANTHROPIC_API_KEY.
 */
@Module({
  imports: [RetrievalModule],
  providers: [
    GenerationService,
    {
      provide: ANTHROPIC_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Anthropic({ apiKey: config.get<string>('ANTHROPIC_API_KEY') }),
    },
  ],
  controllers: [GenerationController],
})
export class GenerationModule {}
