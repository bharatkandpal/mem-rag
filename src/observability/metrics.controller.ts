import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { MetricsService } from './metrics.service';

// prom-client's Prometheus text exposition content type (stable across v0.0.4).
const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * `GET /metrics` — Prometheus scrape endpoint (RAG-63d), mirroring `/healthz`.
 * Thin: delegates rendering to `MetricsService`. When `METRICS_ENABLED=false`
 * the route reports 404 (the endpoint is off), matching the config gate.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  scrape(): Promise<string> {
    if (!this.metrics.enabled) {
      throw new NotFoundException('metrics are disabled (METRICS_ENABLED=false)');
    }
    return this.metrics.render();
  }
}
