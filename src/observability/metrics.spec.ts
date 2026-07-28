import { ConfigService } from '@nestjs/config';
import { lastValueFrom, of } from 'rxjs';
import { MetricsService } from './metrics.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

const configWith = (env: Record<string, string> = {}): ConfigService =>
  ({ get: (k: string, d?: unknown) => env[k] ?? d } as unknown as ConfigService);

// A minimal ExecutionContext/CallHandler good enough for the interceptor.
const httpContext = (req: unknown, res: unknown) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  }) as never;

describe('MetricsService (RAG-63d)', () => {
  it('is enabled by default and exposes the custom series once recorded', async () => {
    const svc = new MetricsService(configWith());
    expect(svc.enabled).toBe(true);

    svc.httpRequests.inc({ route: '/query', method: 'POST', status: '201' });
    svc.httpDuration.observe({ route: '/query' }, 0.12);

    const text = await svc.render();
    expect(text).toContain('rag_http_requests_total');
    expect(text).toContain('rag_http_request_duration_seconds');
    expect(text).toContain('route="/query"');
  });

  it('honours METRICS_ENABLED=false', () => {
    expect(new MetricsService(configWith({ METRICS_ENABLED: 'false' })).enabled).toBe(false);
  });

  it('gives each instance an isolated registry (no cross-instance collision)', () => {
    expect(() => {
      new MetricsService(configWith());
      new MetricsService(configWith());
    }).not.toThrow();
  });
});

describe('HttpMetricsInterceptor (RAG-63d)', () => {
  it('records the request on response finish with the templated route + status', async () => {
    const svc = new MetricsService(configWith());
    const interceptor = new HttpMetricsInterceptor(svc);

    let finish: () => void = () => undefined;
    const res = {
      statusCode: 201,
      on: (event: string, cb: () => void) => {
        if (event === 'finish') finish = cb;
      },
    };
    const req = { method: 'POST', route: { path: '/query' } };

    await lastValueFrom(
      interceptor.intercept(httpContext(req, res), { handle: () => of('ok') }),
    );
    finish(); // simulate the response completing

    const text = await svc.render();
    expect(text).toContain('method="POST"');
    expect(text).toContain('status="201"');
    expect(text).toContain('rag_http_request_duration_seconds_count{route="/query"} 1');
  });

  it('templates the route as "unknown" for an unmatched request (no cardinality blow-up)', async () => {
    const svc = new MetricsService(configWith());
    const interceptor = new HttpMetricsInterceptor(svc);

    let finish: () => void = () => undefined;
    const res = {
      statusCode: 404,
      on: (event: string, cb: () => void) => {
        if (event === 'finish') finish = cb;
      },
    };
    await lastValueFrom(
      interceptor.intercept(httpContext({ method: 'GET' }, res), { handle: () => of('x') }),
    );
    finish();

    expect(await svc.render()).toContain('route="unknown"');
  });

  it('is a no-op (attaches no listener) when metrics are disabled', async () => {
    const svc = new MetricsService(configWith({ METRICS_ENABLED: 'false' }));
    const interceptor = new HttpMetricsInterceptor(svc);
    const on = jest.fn();

    await lastValueFrom(
      interceptor.intercept(
        httpContext({ method: 'GET', route: { path: '/healthz' } }, { statusCode: 200, on }),
        { handle: () => of('ok') },
      ),
    );

    expect(on).not.toHaveBeenCalled();
  });
});

describe('MetricsService domain series (RAG-63e)', () => {
  it('records ingest docs + chunks', async () => {
    const svc = new MetricsService(configWith());
    svc.recordIngest(4, 9);
    const text = await svc.render();
    expect(text).toContain('rag_ingest_docs_total 4');
    expect(text).toContain('rag_ingest_chunks_total 9');
  });

  it('records each query outcome under its own label', async () => {
    const svc = new MetricsService(configWith());
    svc.recordQuery('grounded');
    svc.recordQuery('abstained');
    svc.recordQuery('general');
    const text = await svc.render();
    expect(text).toContain('rag_query_total{outcome="grounded"} 1');
    expect(text).toContain('rag_query_total{outcome="abstained"} 1');
    expect(text).toContain('rag_query_total{outcome="general"} 1');
  });

  it('observes retrieval score and generation duration (by provider)', async () => {
    const svc = new MetricsService(configWith());
    svc.observeRetrievalScore(0.82);
    svc.observeGeneration('anthropic', 1.5);
    const text = await svc.render();
    expect(text).toContain('rag_retrieval_score_count 1');
    expect(text).toContain('rag_generation_duration_seconds_count{provider="anthropic"} 1');
  });

  it('records surfaced faults by type (RAG-63f)', async () => {
    const svc = new MetricsService(configWith());
    svc.recordError('Error');
    const text = await svc.render();
    expect(text).toContain('rag_errors_total{type="Error"} 1');
  });
});
