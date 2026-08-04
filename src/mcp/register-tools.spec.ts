import { registerTools } from './register-tools';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GenerationService } from '../generation/generation.service';
import type { IngestionService } from '../ingestion/ingestion.service';

/**
 * RAG-65d — the MCP_ENABLE_INGEST gate (D2). rag_query is always registered; the
 * corpus-write rag_ingest appears only when enableIngest is true, so with the
 * flag off an agent has no way to see or trigger it.
 */
function registeredToolNames(enableIngest: boolean): string[] {
  const names: string[] = [];
  const server = {
    registerTool: (name: string) => {
      names.push(name);
      return {};
    },
  } as unknown as McpServer;

  registerTools(server, {
    generation: {} as unknown as GenerationService,
    ingestion: {} as unknown as IngestionService,
    enableIngest,
  });
  return names;
}

describe('registerTools — MCP_ENABLE_INGEST gate', () => {
  it('registers only rag_query when the ingest flag is off (the default)', () => {
    const names = registeredToolNames(false);
    expect(names).toEqual(['rag_query']);
    expect(names).not.toContain('rag_ingest');
  });

  it('registers rag_ingest as well when the flag is on', () => {
    const names = registeredToolNames(true);
    expect(names).toContain('rag_query');
    expect(names).toContain('rag_ingest');
    expect(names).toHaveLength(2);
  });
});
