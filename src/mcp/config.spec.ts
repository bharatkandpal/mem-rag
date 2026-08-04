import { resolveMcpServerConfig, DEFAULT_MCP_HTTP_PORT } from './config';

/** Build a getter over a plain env map for the pure resolver. */
const getter = (env: Record<string, string>) => (key: string) => env[key];

describe('resolveMcpServerConfig', () => {
  it('defaults to stdio with no token when nothing is set', () => {
    const cfg = resolveMcpServerConfig(getter({}));
    expect(cfg).toEqual({ transport: 'stdio', httpPort: DEFAULT_MCP_HTTP_PORT, authToken: '' });
  });

  it('accepts http when a bearer token is present', () => {
    const cfg = resolveMcpServerConfig(getter({ MCP_TRANSPORT: 'http', MCP_AUTH_TOKEN: 'secret' }));
    expect(cfg).toEqual({ transport: 'http', httpPort: DEFAULT_MCP_HTTP_PORT, authToken: 'secret' });
  });

  it('FAILS CLOSED: http without a token throws (never serves MCP over HTTP unauthenticated)', () => {
    expect(() => resolveMcpServerConfig(getter({ MCP_TRANSPORT: 'http' }))).toThrow(
      /MCP_AUTH_TOKEN is required/,
    );
  });

  it('is case-insensitive on the transport name', () => {
    expect(resolveMcpServerConfig(getter({ MCP_TRANSPORT: 'HTTP', MCP_AUTH_TOKEN: 't' })).transport).toBe('http');
    expect(resolveMcpServerConfig(getter({ MCP_TRANSPORT: 'Stdio' })).transport).toBe('stdio');
  });

  it('rejects an unknown transport', () => {
    expect(() => resolveMcpServerConfig(getter({ MCP_TRANSPORT: 'grpc' }))).toThrow(/invalid MCP_TRANSPORT/);
  });

  it('honors a custom MCP_HTTP_PORT and rejects a non-numeric one', () => {
    expect(resolveMcpServerConfig(getter({ MCP_TRANSPORT: 'http', MCP_AUTH_TOKEN: 't', MCP_HTTP_PORT: '9000' })).httpPort).toBe(9000);
    expect(() => resolveMcpServerConfig(getter({ MCP_HTTP_PORT: 'abc' }))).toThrow(/invalid MCP_HTTP_PORT/);
  });

  it('stdio never requires a token even if none is set', () => {
    expect(() => resolveMcpServerConfig(getter({ MCP_TRANSPORT: 'stdio' }))).not.toThrow();
  });
});
