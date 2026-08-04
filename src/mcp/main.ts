#!/usr/bin/env node
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppModule } from '../app.module';
import { GenerationService } from '../generation/generation.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { CorrelatedLogger } from '../observability/correlated-logger';
import { registerTools } from './register-tools';

/**
 * MCP server entrypoint (GO-21i / RAG-65) — a third entrypoint over the same
 * in-process NestJS services as the HTTP API (GO-21a–d) and the CLI (GO-21h).
 * It bootstraps a Nest application context (identical pattern to src/cli/main.ts
 * and eval/run-eval.ts; no HTTP hop) and serves an MCP server over stdio.
 *
 * D3 (design guide §5): logs are forced to **stderr** via the RAG-63g
 * CorrelatedLogger so stdout stays a pure JSON-RPC channel — corrupting stdout
 * would break the protocol. This is a correctness requirement, not a preference.
 *
 * Tools (see `register-tools.ts`): `rag_query` (RAG-65b, always on) and the
 * gated `rag_ingest` (RAG-65d, behind `MCP_ENABLE_INGEST`). Streamable HTTP +
 * bearer auth is a later slice (RAG-65e); this entrypoint is stdio-only.
 */

const SERVER_INFO = { name: 'rag', version: '0.1.0' } as const;

async function bootstrap(): Promise<void> {
  // Silent Nest bootstrap, then force all logs to stderr (D3): stdout belongs to
  // the stdio JSON-RPC transport alone.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  app.useLogger(new CorrelatedLogger('stderr'));
  const logger = new Logger('Mcp');

  // Resolve the pipeline services in-process now, so a broken DI graph fails at
  // startup rather than on the first tool call. Both are already instantiated as
  // part of AppModule; resolving them is free.
  const generation = app.get(GenerationService);
  const ingestion = app.get(IngestionService);

  // MCP_ENABLE_INGEST (default off) gates the corpus-write tool (D2): exposing
  // filesystem-read + write to an arbitrary agent is a capability grant, so the
  // shipped server is query-only unless an operator turns it on.
  const config = app.get(ConfigService);
  const enableIngest =
    config.get<string>('MCP_ENABLE_INGEST', 'false') === 'true';

  const server = new McpServer(SERVER_INFO);
  registerTools(server, { generation, ingestion, enableIngest });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.log(
    `MCP server "${SERVER_INFO.name}" v${SERVER_INFO.version} listening over stdio ` +
      `(tools: ${enableIngest ? 'rag_query, rag_ingest' : 'rag_query'})`,
  );

  // Clean shutdown: tear down the MCP transport and the Nest context on signal.
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.log(`received ${signal}, shutting down MCP server`);
    await server.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err: unknown) => {
  // The logger may not be wired on a bootstrap failure, and stdout is the
  // protocol channel — so write diagnostics straight to stderr.
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[mcp] fatal during bootstrap: ${detail}\n`);
  process.exit(1);
});
