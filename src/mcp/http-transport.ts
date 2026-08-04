import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools, type McpToolDeps } from './register-tools';

/** The single MCP endpoint path — matches the connector's `url` (design guide §6). */
export const MCP_PATH = '/mcp';

/**
 * Constant-time bearer check (D4). Returns true only for `Authorization: Bearer <token>`
 * matching `token` exactly. A missing header, wrong scheme, or length/value mismatch
 * fails. Uses `timingSafeEqual` so the comparison doesn't leak the token by timing.
 */
export function isAuthorized(authHeader: string | undefined, token: string): boolean {
  if (!authHeader) return false;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return false;
  const provided = Buffer.from(authHeader.slice(prefix.length));
  const expected = Buffer.from(token);
  // timingSafeEqual throws on unequal lengths — guard first (length isn't secret).
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export interface HttpServerOptions {
  deps: McpToolDeps;
  port: number;
  authToken: string;
  serverInfo: { name: string; version: string };
  logger: Logger;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/**
 * Streamable HTTP transport for the MCP server (RAG-65e, design guide §6) — a
 * self-contained minimal HTTP listener so the MCP layer stays a third entrypoint
 * independent of the web app. Every request to `/mcp` is bearer-gated (D4) before
 * any pipeline work; other paths 404.
 *
 * **Stateless:** a fresh `McpServer` + `StreamableHTTPServerTransport`
 * (`sessionIdGenerator: undefined`) per request — the SDK's recommended stateless
 * pattern, which avoids cross-request id collisions and needs no session store.
 * The pipeline services in `deps` are resolved once and reused across requests.
 */
export function startHttpServer(opts: HttpServerOptions): Promise<Server> {
  const { deps, port, authToken, serverInfo, logger } = opts;

  const httpServer = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      logger.error(`MCP HTTP handler error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!(req.url ?? '').startsWith(MCP_PATH)) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (!isAuthorized(req.headers.authorization, authToken)) {
      sendJson(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
      return;
    }

    const server = new McpServer(serverInfo);
    registerTools(server, deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  return new Promise((resolve) => {
    httpServer.listen(port, () => resolve(httpServer));
  });
}
