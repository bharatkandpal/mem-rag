import { registerQueryTool } from './rag-query.tool';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  GenerationService,
  QueryResult,
} from '../generation/generation.service';

/**
 * RAG-65c — citation serialization at the MCP tool boundary, for both provider
 * types. The MCP layer adds no citation logic of its own; the contract it must
 * honour is: whatever `GenerationService.generate` returns is serialized
 * faithfully into `structuredContent` + text, and a non-citation provider never
 * gains a fabricated citation on the way through (design guide §4, `ai-and-secrets.md`).
 */

type ToolHandler = (args: { question: string }) => Promise<{
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
}>;

interface Registered {
  name: string;
  config: { description?: string; inputSchema?: unknown; outputSchema?: unknown };
  handler: ToolHandler;
}

/** Register the tool against a stub server+service, capturing what was registered. */
function register(generate: jest.Mock): Registered {
  let captured: Registered | undefined;
  const server = {
    registerTool: (name: string, config: Registered['config'], handler: ToolHandler) => {
      captured = { name, config, handler };
      return {};
    },
  } as unknown as McpServer;
  const generation = { generate } as unknown as GenerationService;

  registerQueryTool(server, generation);
  if (!captured) throw new Error('rag_query was not registered');
  return captured;
}

// Anthropic (native-citation) provider: citations mapped to sources, citationsSupported=true.
const anthropicGrounded: QueryResult = {
  answer: 'Retrieval is scored by hit-rate and precision@k.',
  citations: [
    { citedText: 'hit-rate', source: 'TDD.md', documentIndex: 0 },
    { citedText: 'precision@k', source: 'PRD.md', documentIndex: 1 },
  ],
  chunks: [{ content: 'scored by hit-rate and precision@k', source: 'TDD.md', score: 0.81 }],
  abstained: false,
  grounded: true,
  citationsSupported: true,
};

// OpenAI-compatible (local) provider: grounded, but no native citations.
const localGrounded: QueryResult = {
  answer: 'Retrieval is scored by hit-rate and precision@k.',
  citations: [],
  chunks: [{ content: 'scored by hit-rate and precision@k', source: 'TDD.md', score: 0.81 }],
  abstained: false,
  grounded: true,
  citationsSupported: false,
};

const abstain: QueryResult = {
  answer: "I don't have that information in the corpus.",
  citations: [],
  chunks: [],
  abstained: true,
  grounded: false,
  citationsSupported: true,
};

describe('rag_query tool', () => {
  it('registers as rag_query with input + output schemas', () => {
    const { name, config } = register(jest.fn());
    expect(name).toBe('rag_query');
    expect(config.description).toMatch(/corpus/i);
    expect(config.inputSchema).toBeDefined();
    expect(config.outputSchema).toBeDefined();
  });

  it('calls generate() with the question and returns the full QueryResult as structuredContent', async () => {
    const generate = jest.fn().mockResolvedValue(anthropicGrounded);
    const { handler } = register(generate);

    const result = await handler({ question: 'How is retrieval scored?' });

    expect(generate).toHaveBeenCalledWith('How is retrieval scored?');
    // Agents branch on the structured flags — the whole QueryResult survives (D1).
    expect(result.structuredContent).toEqual(anthropicGrounded);
  });

  describe('Anthropic (native-citation) provider', () => {
    it('serializes citations[] mapped to sources in structuredContent', async () => {
      const { handler } = register(jest.fn().mockResolvedValue(anthropicGrounded));
      const { structuredContent } = await handler({ question: 'q' });

      expect(structuredContent.citationsSupported).toBe(true);
      expect(structuredContent.citations).toEqual([
        { citedText: 'hit-rate', source: 'TDD.md', documentIndex: 0 },
        { citedText: 'precision@k', source: 'PRD.md', documentIndex: 1 },
      ]);
    });

    it('renders a numbered Sources list in the text content', async () => {
      const { handler } = register(jest.fn().mockResolvedValue(anthropicGrounded));
      const { content } = await handler({ question: 'q' });

      expect(content[0].type).toBe('text');
      expect(content[0].text).toContain('Sources:');
      expect(content[0].text).toContain('[1] "hit-rate" — TDD.md');
      expect(content[0].text).toContain('[2] "precision@k" — PRD.md');
    });
  });

  describe('openai-compatible (non-citation) provider', () => {
    it('reports citationsSupported:false with an empty citations[] — never fabricated', async () => {
      const { handler } = register(jest.fn().mockResolvedValue(localGrounded));
      const { structuredContent } = await handler({ question: 'q' });

      expect(structuredContent.citationsSupported).toBe(false);
      expect(structuredContent.citations).toEqual([]);
      // Grounding still holds — the answer is from the corpus, just uncited.
      expect(structuredContent.grounded).toBe(true);
    });

    it('omits citation markers and shows an honest capability note in the text', async () => {
      const { handler } = register(jest.fn().mockResolvedValue(localGrounded));
      const { content } = await handler({ question: 'q' });

      expect(content[0].text).not.toContain('Sources:');
      expect(content[0].text).not.toMatch(/\[\d+\]/); // no fabricated [n] markers
      expect(content[0].text).toContain('does not support citations');
    });
  });

  describe('abstain (empty retrieval, D5)', () => {
    it('passes the abstain message through verbatim with no citations or chunks', async () => {
      const { handler } = register(jest.fn().mockResolvedValue(abstain));
      const { content, structuredContent } = await handler({ question: 'off-topic' });

      expect(structuredContent.abstained).toBe(true);
      expect(structuredContent.grounded).toBe(false);
      expect(structuredContent.citations).toEqual([]);
      expect(structuredContent.chunks).toEqual([]);
      expect(content[0].text).toBe("I don't have that information in the corpus.");
      expect(content[0].text).not.toContain('Sources:');
      expect(content[0].text).not.toContain('does not support citations');
    });
  });
});
