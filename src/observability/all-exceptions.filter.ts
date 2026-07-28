import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { getCorrelationId } from './correlation.als';
import { MetricsService } from './metrics.service';

const REQUEST_ID_HEADER = 'x-request-id';

// Structural response shape — only what we use — so we don't depend on @types/express.
interface ErrorResponse {
  status(code: number): ErrorResponse;
  json(body: Record<string, unknown>): void;
  setHeader(name: string, value: string): void;
}

/**
 * Global exception filter — error surfacing (RAG-63f). For every failed request
 * it stamps the correlation id (header + body) so a failure is traceable
 * end-to-end, and it counts genuine server faults.
 *
 * Design rules (guide §5):
 *  - **Only 5xx are errors.** Server faults bump `rag_errors_total{type}` and are
 *    logged with their stack. 4xx (validation) and abstain (a 200 that never
 *    reaches here) are expected control flow — never counted, never stack-logged.
 *  - **Preserve intentional payloads.** An `HttpException`'s own response body
 *    (e.g. `/healthz` db/pgvector flags, validation field messages) is passed
 *    through and only *enriched* with the correlation id — never replaced.
 *  - **Never leak internals.** An unexpected (non-HTTP) error returns a generic
 *    `Internal server error` body; the real message/stack goes to the log only,
 *    and no secret is ever placed in a body, header, or metric label.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly metrics: MetricsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<ErrorResponse>();
    const correlationId = getCorrelationId();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // Keep an HttpException's intentional payload; for an unexpected error use a
    // safe generic body that never leaks internals.
    let body: Record<string, unknown>;
    if (isHttp) {
      const original = exception.getResponse();
      body =
        typeof original === 'string'
          ? { statusCode: status, message: original }
          : { ...(original as Record<string, unknown>) };
    } else {
      body = { statusCode: status, message: 'Internal server error' };
    }

    if (correlationId) {
      body.correlationId = correlationId;
      res.setHeader(REQUEST_ID_HEADER, correlationId);
    }

    // Genuine server faults only — count + stack-log. Client errors are expected.
    if (status >= 500) {
      const type = exception instanceof Error ? exception.constructor.name : 'UnknownError';
      this.metrics.recordError(type);
      this.logger.error(
        `${type} (${status})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json(body);
  }
}
