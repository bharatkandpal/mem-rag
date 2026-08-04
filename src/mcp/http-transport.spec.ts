import { isAuthorized, MCP_PATH } from './http-transport';

describe('isAuthorized (bearer check, D4)', () => {
  const token = 's3cr3t-token';

  it('accepts an exact Bearer match', () => {
    expect(isAuthorized(`Bearer ${token}`, token)).toBe(true);
  });

  it('rejects a missing Authorization header', () => {
    expect(isAuthorized(undefined, token)).toBe(false);
    expect(isAuthorized('', token)).toBe(false);
  });

  it('rejects the wrong token', () => {
    expect(isAuthorized('Bearer nope', token)).toBe(false);
  });

  it('rejects a non-Bearer scheme', () => {
    expect(isAuthorized(`Basic ${token}`, token)).toBe(false);
    expect(isAuthorized(token, token)).toBe(false); // raw token, no scheme
  });

  it('rejects a token that is a prefix/suffix of the expected (length mismatch)', () => {
    expect(isAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(isAuthorized(`Bearer ${token.slice(0, -1)}`, token)).toBe(false);
  });

  it('exposes the endpoint path the connector targets', () => {
    expect(MCP_PATH).toBe('/mcp');
  });
});
