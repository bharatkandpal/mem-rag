import { CorrelationMiddleware } from './correlation.middleware';
import { getCorrelationId, runWithCorrelation } from './correlation.als';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('correlation context (RAG-63b)', () => {
  describe('runWithCorrelation / getCorrelationId', () => {
    it('exposes the id inside the scope and nothing outside', () => {
      expect(getCorrelationId()).toBeUndefined();
      runWithCorrelation(() => {
        expect(getCorrelationId()).toBe('fixed-id');
      }, 'fixed-id');
      expect(getCorrelationId()).toBeUndefined();
    });

    it('mints a uuid when none is provided', () => {
      let seen: string | undefined;
      runWithCorrelation(() => {
        seen = getCorrelationId();
      });
      expect(seen).toMatch(UUID_RE);
    });

    it('propagates the id across an async boundary', async () => {
      let seen: string | undefined;
      await runWithCorrelation(async () => {
        await Promise.resolve();
        seen = getCorrelationId();
      }, 'async-id');
      expect(seen).toBe('async-id');
    });
  });

  describe('CorrelationMiddleware', () => {
    const run = (headers: Record<string, string | string[] | undefined>) => {
      const middleware = new CorrelationMiddleware();
      let echoed: string | undefined;
      const req = { headers };
      const res = {
        setHeader: (name: string, value: string) => {
          if (name === 'x-request-id') echoed = value;
        },
      };
      let idInside: string | undefined;
      middleware.use(req, res, () => {
        idInside = getCorrelationId();
      });
      return { echoed, idInside };
    };

    it('honours a non-empty inbound x-request-id', () => {
      const { echoed, idInside } = run({ 'x-request-id': 'trace-abc' });
      expect(echoed).toBe('trace-abc');
      expect(idInside).toBe('trace-abc');
    });

    it('mints and echoes a uuid when the header is absent', () => {
      const { echoed, idInside } = run({});
      expect(echoed).toMatch(UUID_RE);
      expect(idInside).toBe(echoed);
    });

    it('ignores a blank header and mints instead', () => {
      const { echoed, idInside } = run({ 'x-request-id': '   ' });
      expect(echoed).toMatch(UUID_RE);
      expect(idInside).toBe(echoed);
    });

    it('takes the first value when the header arrives as an array', () => {
      const { echoed, idInside } = run({ 'x-request-id': ['first', 'second'] });
      expect(echoed).toBe('first');
      expect(idInside).toBe('first');
    });
  });
});
