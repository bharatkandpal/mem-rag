#!/usr/bin/env node
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppModule } from '../app.module';
import { GenerationService } from '../generation/generation.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { CorrelatedLogger } from '../observability/correlated-logger';
import { registerTools, type McpToolDeps } from './register-tools';
import { resolveMcpServerConfig } from './config';
import { startHttpServer } from './http-transport';

/**
 * MCP server entrypoint (GO-21i / RAG-65) — a third entrypoint over the same
 * in-process NestJS services as the HTTP API (GO-21a–d) and the CLI (GO-21h).
 * It bootstraps a Nest application context (identical pattern to src/cli/main.ts
 * and eval/run-eval.ts; no HTTP hop into the pipeline) and serves the MCP tools.
 *
 * Transports (design guide §6), selected by `MCP_TRANSPORT` (default `stdio`):
 *  - **stdio** — local agents (Claude Desktop/Code); logs forced to **stderr**
 *    via the RAG-63g CorrelatedLogger so stdout stays a pure JSON-RPC channel (D3).
 *  - **http** — Streamable HTTP + bearer auth (RAG-65e) for remote agents and the
 *    Anthropic API MCP connector; a self-contained listener (see `http-transport.ts`).
 *
 * Tools (see `register-tools.ts`): `rag_query` (RAG-65b, always on) and the gated
 * `rag_ingest` (RAG-65d, behind `MCP_ENABLE_INGEST`).
 */

const SERVER_INFO = { name: 'rag', version: '0.1.0' } as const;

async function bootstrap(): Promise<void> {
  // Silent Nest bootstrap, then force all logs to stderr (D3): under stdio, stdout
  // belongs to the JSON-RPC transport alone (harmless but consistent under http).
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

  const config = app.get(ConfigService);
  // MCP_ENABLE_INGEST (default off) gates the corpus-write tool (D2).
  const enableIngest = config.get<string>('MCP_ENABLE_INGEST', 'false') === 'true';
  const deps: McpToolDeps = { generation, ingestion, enableIngest };
  const toolList = enableIngest ? 'rag_query, rag_ingest' : 'rag_query';

  // Transport selection + fail-closed validation (http requires a bearer token).
  const { transport, httpPort, authToken } = resolveMcpServerConfig((k) =>
    config.get<string>(k),
  );

  // Track what to tear down on shutdown — a stdio McpServer or the HTTP listener.
  let stdioServer: McpServer | undefined;
  let httpServer: Server | undefined;

  if (transport === 'http') {
    httpServer = await startHttpServer({
      deps,
      port: httpPort,
      authToken,
      serverInfo: SERVER_INFO,
      logger,
    });
    logger.log(
      `MCP server "${SERVER_INFO.name}" v${SERVER_INFO.version} listening over ` +
        `Streamable HTTP on :${httpPort}/mcp (bearer auth; tools: ${toolList})`,
    );
  } else {
    stdioServer = new McpServer(SERVER_INFO);
    registerTools(stdioServer, deps);
    await stdioServer.connect(new StdioServerTransport());
    logger.log(
      `MCP server "${SERVER_INFO.name}" v${SERVER_INFO.version} listening over ` +
        `stdio (tools: ${toolList})`,
    );
  }

  // Clean shutdown: tear down the active transport and the Nest context on signal.
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.log(`received ${signal}, shutting down MCP server`);
    if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
    if (stdioServer) await stdioServer.close();
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
