import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GenerationService } from '../generation/generation.service';
import type { IngestionService } from '../ingestion/ingestion.service';
import { registerQueryTool } from './rag-query.tool';
import { registerIngestTool } from './rag-ingest.tool';

/**
 * Services + config the MCP tools need, resolved once from the app context by
 * the entrypoint. `enableIngest` is the `MCP_ENABLE_INGEST` gate (D2).
 */
export interface McpToolDeps {
  generation: GenerationService;
  ingestion: IngestionService;
  enableIngest: boolean;
}

/**
 * Registers the MCP tool set on `server`, applying the write-capability gate.
 * `rag_query` is always on; `rag_ingest` is registered **only** when
 * `enableIngest` is true — so with the flag off it never appears in `tools/list`,
 * and an agent has no way to trigger a corpus write (design guide §3, D2).
 *
 * Kept as a small pure function (no Nest, no config reads) so the gate is
 * unit-testable without booting an application context.
 */
export function registerTools(server: McpServer, deps: McpToolDeps): void {
  registerQueryTool(server, deps.generation);
  if (deps.enableIngest) {
    registerIngestTool(server, deps.ingestion);
  }
}
