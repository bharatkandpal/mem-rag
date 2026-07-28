import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { MetricsService } from './metrics.service';
import { runWithCorrelation } from './correlation.als';

describe('AllExceptionsFilter (RAG-63f)', () => {
  let metrics: { recordError: jest.Mock };
  let filter: AllExceptionsFilter;

  const buildRes = () => {
    const res: { statusCode: number; body?: Record<string, unknown>; headers: Record<string, string>; status: jest.Mock; json: jest.Mock; setHeader: jest.Mock } = {
      statusCode: 0,
      headers: {},
      status: jest.fn(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };
    res.status.mockImplementation((c: number) => {
      res.statusCode = c;
      return res;
    });
    res.json.mockImplementation((b: Record<string, unknown>) => {
      res.body = b;
    });
    res.setHeader.mockImplementation((k: string, v: string) => {
      res.headers[k] = v;
    });
    return res;
  };

  const hostFor = (res: unknown): ArgumentsHost =>
    ({ switchToHttp: () => ({ getResponse: () => res }) }) as unknown as ArgumentsHost;

  beforeEach(() => {
    metrics = { recordError: jest.fn() };
    filter = new AllExceptionsFilter(metrics as unknown as MetricsService);
  });

  it('maps an unexpected error to a generic 500, counts it, and surfaces the id', () => {
    const res = buildRes();

    runWithCorrelation(() => filter.catch(new Error('boom: secret=xyz'), hostFor(res)), 'cid-500');

    expect(res.statusCode).toBe(500);
    // Never leaks the internal message — generic body only.
    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      correlationId: 'cid-500',
    });
    expect(res.headers['x-request-id']).toBe('cid-500');
    expect(metrics.recordError).toHaveBeenCalledWith('Error');
  });

  it('does not count a 4xx client error but returns a traceable, structured body', () => {
    const res = buildRes();

    runWithCorrelation(() => filter.catch(new BadRequestException('bad input'), hostFor(res)), 'cid-400');

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: 'bad input', correlationId: 'cid-400' });
    expect(metrics.recordError).not.toHaveBeenCalled();
  });

  it('preserves an HttpException payload and enriches it with the id (e.g. /healthz 503)', () => {
    const res = buildRes();
    const health = new ServiceUnavailableException({ status: 'degraded', db: false, pgvector: true });

    runWithCorrelation(() => filter.catch(health, hostFor(res)), 'cid-503');

    expect(res.statusCode).toBe(503);
    // Original diagnostic fields survive; only correlationId is added.
    expect(res.body).toMatchObject({ status: 'degraded', db: false, pgvector: true, correlationId: 'cid-503' });
    expect(metrics.recordError).toHaveBeenCalledWith('ServiceUnavailableException');
  });

  it('handles a 5xx HttpException with a string payload as a fault', () => {
    const res = buildRes();

    filter.catch(new HttpException('upstream exploded', 502), hostFor(res));

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ statusCode: 502, message: 'upstream exploded' });
    expect(metrics.recordError).toHaveBeenCalledWith('HttpException');
  });

  it('omits the id when there is no correlation scope', () => {
    const res = buildRes();

    filter.catch(new BadRequestException('nope'), hostFor(res));

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.body).not.toHaveProperty('correlationId');
  });
});
