import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { CorrelationMiddleware } from './correlation.middleware';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Global observability module (RAG-63). Owns the request-tracing, metrics, and
 * error-surfacing wiring so it stays isolated from feature code and the OTel
 * swap seam (guide §6) has one home. `@Global` so any feature service can inject
 * `MetricsService` for domain instrumentation (RAG-63e) without import wiring.
 *
 * Landed: correlation-ID context + HTTP middleware (RAG-63b); prom-client
 * registry + `GET /metrics` + HTTP request interceptor (RAG-63d); domain metrics
 * recorded by the feature services (RAG-63e); the global exception filter (RAG-63f).
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
