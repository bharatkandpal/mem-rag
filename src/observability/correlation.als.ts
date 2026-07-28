import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface CorrelationStore {
  correlationId: string;
}

/**
 * Request-scoped correlation context (RAG-63b). Propagates one id across the
 * async call chain (ingest → retrieve → generate) without threading an argument
 * through every signature. HTTP requests enter via `CorrelationMiddleware`; CLI
 * invocations via `runWithCorrelation` (RAG-63g). The correlated logger (RAG-63c)
 * reads the id from here to stamp every existing RAG-42 log line, and the
 * exception filter (RAG-63f) surfaces it in the error body.
 *
 * Kept behind these tiny helpers so a later swap to OpenTelemetry span context
 * (guide §6) is additive, not a rewrite.
 */
export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

/** Run `fn` inside a fresh correlation scope, minting an id when none is given. */
export function runWithCorrelation<T>(fn: () => T, correlationId: string = randomUUID()): T {
  return correlationStorage.run({ correlationId }, fn);
}

/** The current request's correlation id, or `undefined` outside any scope. */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}
