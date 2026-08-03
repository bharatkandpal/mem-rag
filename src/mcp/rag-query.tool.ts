import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GenerationService } from '../generation/generation.service';
import { renderQueryResult } from './render';

/**
 * `rag_query` — the headline MCP tool (design guide §3). Answers a question over
 * the ingested corpus via the same in-process `GenerationService` the HTTP API
 * and CLI use; the MCP layer adds no retrieval/abstain/citation logic of its own.
 *
 * The description is deliberately prescriptive about *when* to call and about the
 * abstain contract — a programmatic agent must treat `grounded:false` as a real
 * answer, not an error (measurably lifts correct tool-selection on current models).
 */
const RAG_QUERY_DESCRIPTION =
  'Answer a question using only the ingested document corpus, returning a grounded ' +
  'answer with citations to source passages. Call this when the user asks something ' +
  'the corpus would contain. It returns a grounded:false "not in the corpus" result ' +
  'rather than guessing — treat that as a real answer, not an error.';

/**
 * Output schema mirrors `QueryResult` (src/generation/generation.service.ts —
 * server is the source of truth; keep in lockstep). Declaring it means the SDK
 * validates our `structuredContent` on every call and advertises the shape to
 * clients (D1), so an agent can branch on `grounded` / `abstained` without
 * string-matching the answer text.
 */
const RAG_QUERY_OUTPUT = {
  answer: z.string(),
  citations: z.array(
    z.object({
      citedText: z.string(),
      source: z.string(),
      documentIndex: z.number(),
    }),
  ),
  chunks: z.array(
    z.object({
      content: z.string(),
      source: z.string(),
      score: z.number(),
    }),
  ),
  abstained: z.boolean(),
  grounded: z.boolean(),
  citationsSupported: z.boolean(),
};

export function registerQueryTool(
  server: McpServer,
  generation: GenerationService,
): void {
  server.registerTool(
    'rag_query',
    {
      title: 'Query the corpus',
      description: RAG_QUERY_DESCRIPTION,
      inputSchema: {
        question: z
          .string()
          .min(1)
          .describe('The question to answer over the ingested corpus'),
      },
      outputSchema: RAG_QUERY_OUTPUT,
    },
    async ({ question }) => {
      // Abstain-on-empty-retrieval lives inside generate() (D5), so it's
      // inherited here for free — we surface the result honestly, never mask it.
      const result = await generation.generate(question);
      return {
        content: [{ type: 'text' as const, text: renderQueryResult(result) }],
        // Spread into a fresh object literal: the SDK types structuredContent as
        // Record<string, unknown>, which a named interface (QueryResult) doesn't
        // implicitly satisfy — an anonymous object literal does. Same data.
        structuredContent: { ...result },
      };
    },
  );
}
