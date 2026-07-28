import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { correlationStorage } from './correlation.als';

const REQUEST_ID_HEADER = 'x-request-id';

// Structural request/response shapes — only the fields we touch — so we don't
// depend on @types/express just to read a header and set one.
interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
}
interface OutgoingResponse {
  setHeader(name: string, value: string): void;
}

/**
 * Opens a correlation scope for every HTTP request (RAG-63b): honours an inbound
 * `x-request-id` (so an upstream/proxy trace id is preserved) else mints a
 * `randomUUID()`, echoes it on the response header, and runs the rest of the
 * request inside the ALS scope so all downstream logs share the id.
 *
 * Correlation is middleware (not an interceptor) on purpose: it must wrap the
 * whole request lifecycle, including failures handled by the global exception
 * filter (RAG-63f), which an interceptor would sit inside of.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: IncomingRequest, res: OutgoingResponse, next: () => void): void {
    const raw = req.headers[REQUEST_ID_HEADER];
    const inbound = Array.isArray(raw) ? raw[0] : raw;
    const correlationId = inbound && inbound.trim() !== '' ? inbound : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, correlationId);
    correlationStorage.run({ correlationId }, next);
  }
}
