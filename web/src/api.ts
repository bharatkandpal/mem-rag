import type { QueryResult } from './types';

/**
 * The one and only network surface for the UI (design guide §9). Everything
 * that talks to the server goes through here so error handling and the
 * correlation-id contract live in a single place.
 */

const QUERY_ENDPOINT = '/query';

/** The shape the server's exception filter returns on error (RAG-63). */
interface ErrorBody {
  statusCode?: number;
  message?: string | string[];
  correlationId?: string;
}

/**
 * A failed `/query`. Carries the HTTP status and, when the server supplied
 * one, the request correlation id — surfaced in the UI's error state so a
 * failed answer is traceable end-to-end (design guide §9, RAG-63).
 */
export class QueryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

/** POST a question to `/query` and return the typed result. */
export async function fetchQuery(question: string, signal?: AbortSignal): Promise<QueryResult> {
  let res: Response;
  try {
    res = await fetch(QUERY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal,
    });
  } catch (cause) {
    // Network failure / aborted before any response.
    throw new QueryError(cause instanceof Error ? cause.message : 'Network request failed');
  }

  if (!res.ok) {
    const body = await safeJson<ErrorBody>(res);
    const rawMessage = body?.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(', ')
      : (rawMessage ?? `Request failed (${res.status})`);
    const correlationId = body?.correlationId ?? res.headers.get('x-request-id') ?? undefined;
    throw new QueryError(message, res.status, correlationId);
  }

  return (await res.json()) as QueryResult;
}

/** Parse a response as JSON, tolerating a non-JSON body (returns null). */
async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
