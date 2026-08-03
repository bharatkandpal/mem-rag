import type { QueryResult } from '../generation/generation.service';

/**
 * Text rendering of a QueryResult for MCP clients that only display text
 * (design guide §4). Structure: the answer verbatim, then a numbered source
 * list `[n] "citedText" — source`.
 *
 * Two honesty rules carried over from the rest of the pipeline:
 *  - **Abstain passes through verbatim** (D5) — an abstained answer renders as
 *    just its message, no "Sources" section, never masked as an error.
 *  - **A non-citation provider** (`citationsSupported: false`, e.g. the local
 *    OpenAI-compatible LLM) gets an explicit capability note instead of markers,
 *    never a fabricated citation (`ai-and-secrets.md`, RAG-62).
 *
 * Deviation from the guide's "inline `[n]` markers": our `Citation` carries the
 * **source** span (`citedText` + `documentIndex`), not an offset into the answer
 * text, so there is no faithful position to inject `[n]` mid-sentence. A trailing
 * numbered list is the honest rendering — it invents no answer positions. Agents
 * that want structure read the `structuredContent` (full `QueryResult`) instead.
 */
export function renderQueryResult(result: QueryResult): string {
  const lines: string[] = [result.answer];

  if (result.citations.length > 0) {
    lines.push('', 'Sources:');
    result.citations.forEach((c, i) => {
      lines.push(`[${i + 1}] "${c.citedText}" — ${c.source}`);
    });
  } else if (!result.abstained && !result.citationsSupported) {
    lines.push('', '(configured generation provider does not support citations)');
  }

  return lines.join('\n');
}
