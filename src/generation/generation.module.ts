import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { GENERATION_PROVIDER, GenerationProvider } from './generation-provider.interface';
import { AnthropicGenerationProvider } from './anthropic-generation.provider';
import { OpenAICompatibleGenerationProvider } from './openai-compatible-generation.provider';

/**
 * Generation feature module (RAG-25-30, D4 update). Imports RetrievalModule to
 * consume RetrievalService. GENERATION_PROVIDER is env-selected — Claude
 * remains the default; swapping providers never touches GenerationService or
 * the controller (rule coding-standards.md — adapters are the swap points).
 */
@Module({
  imports: [RetrievalModule],
  providers: [
    GenerationService,
    {
      provide: GENERATION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): GenerationProvider => {
        const name = config.get<string>('GENERATION_PROVIDER', 'anthropic');
        switch (name) {
          case 'anthropic': {
            const client = new Anthropic({
              apiKey: config.get<string>('ANTHROPIC_API_KEY'),
            });
            return new AnthropicGenerationProvider(
              client,
              config.get<string>('GENERATION_MODEL'),
            );
          }
          // Proves the seam: OpenAI itself, or any self-hosted OpenAI-compatible
          // server (Ollama, LM Studio, vLLM) — including small local models.
          case 'openai-compatible':
            return new OpenAICompatibleGenerationProvider(
              config.get<string>('GENERATION_BASE_URL', ''),
              config.get<string>('GENERATION_MODEL', ''),
              config.get<string>('GENERATION_API_KEY'),
            );
          default:
            throw new Error(`Unknown GENERATION_PROVIDER: ${name}`);
        }
      },
    },
  ],
  controllers: [GenerationController],
})
export class GenerationModule {}
