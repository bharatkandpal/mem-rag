import { registerIngestTool } from './rag-ingest.tool';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IngestionService } from '../ingestion/ingestion.service';

type ToolHandler = (args: { path: string }) => Promise<{
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
}>;

interface Registered {
  name: string;
  config: { description?: string; inputSchema?: unknown; outputSchema?: unknown };
  handler: ToolHandler;
}

function register(ingest: jest.Mock): Registered {
  let captured: Registered | undefined;
  const server = {
    registerTool: (name: string, config: Registered['config'], handler: ToolHandler) => {
      captured = { name, config, handler };
      return {};
    },
  } as unknown as McpServer;
  const ingestion = { ingest } as unknown as IngestionService;

  registerIngestTool(server, ingestion);
  if (!captured) throw new Error('rag_ingest was not registered');
  return captured;
}

describe('rag_ingest tool', () => {
  it('registers as rag_ingest with input (path) + output (docs/chunks/ms) schemas', () => {
    const { name, config } = register(jest.fn());
    expect(name).toBe('rag_ingest');
    expect(config.description).toMatch(/index/i);
    expect(config.inputSchema).toBeDefined();
    expect(config.outputSchema).toBeDefined();
  });

  it('calls ingest() with the path and returns the stats as structuredContent + text', async () => {
    const ingest = jest.fn().mockResolvedValue({ docs: 4, chunks: 9, ms: 123 });
    const { handler } = register(ingest);

    const result = await handler({ path: 'eval/sample-corpus' });

    expect(ingest).toHaveBeenCalledWith('eval/sample-corpus');
    expect(result.structuredContent).toEqual({ docs: 4, chunks: 9, ms: 123 });
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('Ingested 4 docs → 9 chunks in 123ms');
  });
});
