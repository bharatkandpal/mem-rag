import { ConsoleLogger } from '@nestjs/common';
import { CorrelatedLogger } from './correlated-logger';
import { runWithCorrelation } from './correlation.als';

describe('CorrelatedLogger (RAG-63c)', () => {
  let superLog: jest.SpyInstance;

  beforeEach(() => {
    // Intercept the ConsoleLogger base so nothing prints and we can assert the
    // message the correlated logger forwards upward.
    superLog = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => superLog.mockRestore());

  it('prefixes the message with the correlation id inside a scope', () => {
    const logger = new CorrelatedLogger();
    runWithCorrelation(() => logger.log('ingested 3 docs'), 'cid-1');
    expect(superLog).toHaveBeenCalledWith('[cid-1] ingested 3 docs');
  });

  it('leaves the message unchanged outside any scope', () => {
    new CorrelatedLogger().log('rag API listening on :3000');
    expect(superLog).toHaveBeenCalledWith('rag API listening on :3000');
  });

  it('preserves a trailing context argument (the Nest logger name)', () => {
    const logger = new CorrelatedLogger();
    runWithCorrelation(() => logger.log('retrieve: 3 hits', 'RetrievalService'), 'cid-2');
    expect(superLog).toHaveBeenCalledWith('[cid-2] retrieve: 3 hits', 'RetrievalService');
  });

  it('does not prefix non-string messages', () => {
    const logger = new CorrelatedLogger();
    const payload = { docs: 3 };
    runWithCorrelation(() => logger.log(payload), 'cid-3');
    expect(superLog).toHaveBeenCalledWith(payload);
  });
});

describe('CorrelatedLogger stream routing (RAG-63g)', () => {
  let out: jest.SpyInstance;
  let err: jest.SpyInstance;

  beforeEach(() => {
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    out.mockRestore();
    err.mockRestore();
  });

  it("forces 'log' output to stderr when constructed with forcedStream='stderr' (CLI)", () => {
    new CorrelatedLogger('stderr').log('ingested 4 docs');
    expect(err).toHaveBeenCalled();
    expect(out).not.toHaveBeenCalled();
  });

  it('leaves normal log output on stdout by default (HTTP app)', () => {
    new CorrelatedLogger().log('rag API listening on :3000');
    expect(out).toHaveBeenCalled();
  });
});
