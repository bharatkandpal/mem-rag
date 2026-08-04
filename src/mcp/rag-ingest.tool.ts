import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IngestionService } from '../ingestion/ingestion.service';

/**
 * `rag_ingest` — the secondary, **gated** MCP tool (design guide §3, D2). Chunks,
 * embeds, and indexes the documents under a filesystem path into the corpus via
 * the same in-process `IngestionService` the CLI and HTTP API use (idempotent —
 * upsert on `UNIQUE(doc_id, chunk_index)`).
 *
 * Exposing filesystem-read + corpus-write to an arbitrary agent is a capability
 * grant, so registration is gated behind `MCP_ENABLE_INGEST` (default off) — see
 * `registerTools`. This function only defines the tool; the gate lives one level up.
 */
const RAG_INGEST_DESCRIPTION =
  'Chunk, embed, and index the documents under a filesystem path into the corpus (idempotent).';

const RAG_INGEST_OUTPUT = {
  docs: z.number(),
  chunks: z.number(),
  ms: z.number(),
};

export function registerIngestTool(
  server: McpServer,
  ingestion: IngestionService,
): void {
  server.registerTool(
    'rag_ingest',
    {
      title: 'Ingest documents into the corpus',
      description: RAG_INGEST_DESCRIPTION,
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Filesystem path to a document file or folder to ingest'),
      },
      outputSchema: RAG_INGEST_OUTPUT,
    },
    async ({ path }) => {
      const stats = await ingestion.ingest(path);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Ingested ${stats.docs} docs → ${stats.chunks} chunks in ${stats.ms}ms`,
          },
        ],
        // Fresh object literal: the SDK types structuredContent as
        // Record<string, unknown>, which a named interface doesn't satisfy.
        structuredContent: { ...stats },
      };
    },
  );
}
