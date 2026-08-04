export type McpTransport = 'stdio' | 'http';

export interface McpServerConfig {
  transport: McpTransport;
  httpPort: number;
  /** Bearer token for the HTTP transport; '' for stdio (no auth — D4). */
  authToken: string;
}

/** Default port for the HTTP transport (kept off the app's 3000). */
export const DEFAULT_MCP_HTTP_PORT = 3001;

/**
 * Resolves the MCP transport config from env (RAG-65e). Pure — takes a getter so
 * it's unit-testable without a ConfigService. **Fail-closed:** `MCP_TRANSPORT=http`
 * without `MCP_AUTH_TOKEN` throws, so the server never serves MCP over the network
 * without a bearer (D4, `ai-and-secrets.md`). stdio stays unauthenticated by design
 * (parent-process trust).
 */
export function resolveMcpServerConfig(
  get: (key: string) => string | undefined,
): McpServerConfig {
  const raw = (get('MCP_TRANSPORT') ?? 'stdio').toLowerCase();
  if (raw !== 'stdio' && raw !== 'http') {
    throw new Error(`invalid MCP_TRANSPORT: "${raw}" (expected "stdio" or "http")`);
  }
  const transport = raw as McpTransport;

  const portRaw = get('MCP_HTTP_PORT');
  const httpPort = portRaw ? Number(portRaw) : DEFAULT_MCP_HTTP_PORT;
  if (!Number.isInteger(httpPort) || httpPort <= 0) {
    throw new Error(`invalid MCP_HTTP_PORT: "${portRaw}"`);
  }

  const authToken = get('MCP_AUTH_TOKEN') ?? '';
  if (transport === 'http' && authToken === '') {
    throw new Error(
      'MCP_AUTH_TOKEN is required when MCP_TRANSPORT=http — refusing to serve MCP ' +
        'over HTTP without a bearer token',
    );
  }

  return { transport, httpPort, authToken };
}
