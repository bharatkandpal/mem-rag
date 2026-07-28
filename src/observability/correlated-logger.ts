import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { getCorrelationId } from './correlation.als';

/**
 * A `ConsoleLogger` that prefixes each line with the current correlation id from
 * ALS (RAG-63c). Registered via `app.useLogger(new CorrelatedLogger())` in
 * `main.ts` so every existing per-class `new Logger(name)` call site (the RAG-42
 * counts+latency logs) becomes correlated with **zero call-site changes**.
 *
 * Outside a request scope (bootstrap, or before the correlation middleware) there
 * is no id, so the message is passed through untouched. Non-string messages are
 * left as-is — Nest formats those specially and prefixing would corrupt them.
 *
 * `forcedStream` pins every line to one stream. The CLI (RAG-63g) passes
 * `'stderr'` so operational logs are diagnostics and `stdout` stays a clean,
 * pipeable result. The HTTP app leaves it unset — Nest's normal stdout/stderr
 * split (errors → stderr) is preserved.
 */
export class CorrelatedLogger extends ConsoleLogger {
  constructor(private readonly forcedStream?: 'stdout' | 'stderr') {
    super();
  }

  log(message: unknown, ...rest: unknown[]): void {
    super.log(this.withCorrelation(message), ...rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    super.error(this.withCorrelation(message), ...rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    super.warn(this.withCorrelation(message), ...rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    super.debug(this.withCorrelation(message), ...rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(this.withCorrelation(message), ...rest);
  }

  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
  ): void {
    super.printMessages(messages, context, logLevel, this.forcedStream ?? writeStreamType);
  }

  private withCorrelation(message: unknown): unknown {
    const id = getCorrelationId();
    if (!id || typeof message !== 'string') {
      return message;
    }
    return `[${id}] ${message}`;
  }
}
