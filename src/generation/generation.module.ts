import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { RagRetrievalOptions } from '../retrieval/retrieval.service';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { GENERATION_PROVIDER, GenerationProvider } from './generation-provider.interface';
import { AnthropicGenerationProvider } from './anthropic-generation.provider';
import { OpenAICompatibleGenerationProvider } from './openai-compatible-generation.provider';

export type GenerationProviderName = 'anthropic' | 'openai-compatible';

/**
 * Builds the `GenerationProvider` bound to `GENERATION_PROVIDER`. `override` is
 * the RAG-66c `RagModule.forRoot({ generationProvider })` seam: a concrete
 * `GenerationProvider` instance is used as-is (a host supplying its own model
 * integration); a name (`'anthropic' | 'openai-compatible'`) picks that impl
 * instead of reading env; `undefined` falls back to `GENERATION_PROVIDER` env,
 * exactly as before RAG-66c. Claude remains the default either way.
 */
export function resolveGenerationProvider(
  config: ConfigService,
  override?: GenerationProviderName | GenerationProvider,
): GenerationProvider {
  if (override && typeof override === 'object') return override;
  const name = override ?? config.get<string>('GENERATION_PROVIDER', 'anthropic');
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
}

/** RAG-66c override surface for `GenerationModule.register()`. */
export interface GenerationModuleOptions {
  generationProvider?: GenerationProviderName | GenerationProvider;
  /** Register `POST /query`(`/general`)? Default `false` — a host embedding the
   * services usually wants them called in-process, not as HTTP routes. */
  http?: boolean;
  /** Threaded down to `RetrievalModule.register()` — same k/minScore override. */
  retrieval?: RagRetrievalOptions;
}

/**
 * Generation feature module (RAG-25-30, D4 update; RAG-66c). `@Module()` here
 * intentionally carries **only** `GenerationService` + the default (env-only)
 * `GENERATION_PROVIDER` factory — `imports` and `controllers` live solely in
 * `register()` below.
 *
 * Why: NestJS concatenates a class's static `@Module()` metadata with a
 * `DynamicModule`'s own `imports`/`controllers`/`providers` — it never
 * *replaces* them (`scanner.js`'s `reflectImports`/`reflectControllers` spread
 * both together). `providers` concatenation is harmless (Nest's provider map is
 * keyed by token, so a duplicate registration just overwrites — this is what
 * makes the `generationProvider` override above safe). But `imports` and
 * `controllers` are plain arrays with no such dedup: a decorator-level
 * `imports: [RetrievalModule]` would sit *alongside* `register()`'s own
 * `RetrievalModule.register(options.retrieval)` as a second, differently-keyed
 * module instance, and DI would silently wire `GenerationService` to whichever
 * one wins — dropping the override with no error. Likewise a decorator-level
 * `controllers: [GenerationController]` would always be added regardless of
 * `register()`'s `http` flag, defeating the toggle. Keeping those two keys out
 * of the decorator — and instead building the whole module through `register()`
 * everywhere, including the standalone app's own `AppModule` — makes
 * `register()` the single source of truth: exactly what the RAG-66 rule
 * ("adapters are the swap points, one wiring authority") already requires.
 */
@Module({
  providers: [
    GenerationService,
    {
      provide: GENERATION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): GenerationProvider =>
        resolveGenerationProvider(config),
    },
  ],
  // Exported so RagModule (the embeddable surface, RAG-66) can re-export it to a host.
  exports: [GenerationService],
})
export class GenerationModule {
  /**
   * The only way this module is ever imported (by `AppModule` and by
   * `RagModule.forRoot()` alike) — see the class doc for why `imports` /
   * `controllers` must live here and not in the decorator.
   */
  static register(options: GenerationModuleOptions = {}): DynamicModule {
    // Captured once and re-exported by this same object reference (not the bare
    // `RetrievalModule` class) — exporting the class would have Nest resolve the
    // re-export against a *different* RetrievalModule instance, silently
    // dropping the k/minScore override.
    const retrievalModule = RetrievalModule.register(options.retrieval);
    return {
      module: GenerationModule,
      imports: [retrievalModule],
      providers: [
        GenerationService,
        {
          provide: GENERATION_PROVIDER,
          inject: [ConfigService],
          useFactory: (config: ConfigService): GenerationProvider =>
            resolveGenerationProvider(config, options.generationProvider),
        },
      ],
      controllers: options.http ? [GenerationController] : [],
      exports: [GenerationService, retrievalModule],
    };
  }
}
