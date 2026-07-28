import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { MetricsService } from './metrics.service';

// Structural shapes — only the fields we read — so we don't pull in @types/express.
interface MetricsRequest {
  method: string;
  route?: { path?: string };
}
interface MetricsResponse {
  statusCode: number;
  on(event: string, listener: () => void): void;
}

/**
 * Records `rag_http_requests_total` + `rag_http_request_duration_seconds` for
 * every controller request (RAG-63d). An interceptor (not raw middleware) on
 * purpose: it fires only on matched controller routes, so `route` is the
 * templated path (`/query`, not the body) — the static assets served from
 * `web/public` never reach it, keeping label cardinality bounded.
 *
 * Records on the response `finish` event so the status reflects the final code
 * (Nest's 201-for-POST default, 4xx validation, or a 5xx set by the exception
 * filter) rather than a not-yet-applied value at interceptor time.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.metrics.enabled || context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<MetricsRequest>();
    const res = http.getResponse<MetricsResponse>();
    const method = req.method;
    const stopTimer = this.metrics.httpDuration.startTimer();

    res.on('finish', () => {
      const route = req.route?.path ?? 'unknown';
      stopTimer({ route });
      this.metrics.httpRequests.inc({ route, method, status: String(res.statusCode) });
    });

    return next.handle();
  }
}
