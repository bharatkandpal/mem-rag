import { useMemo, useState } from 'react';
import type { QueryResult } from '../types';
import { AnswerBody } from './AnswerBody';
import { CapabilityNote } from './CapabilityNote';
import { CitationList } from './CitationList';
import { SourcesPanel } from './SourcesPanel';
import './AnswerView.css';

/**
 * The full answered state (design guide §5): the answer, the grouped numbered
 * citations, the honest capability note when the provider can't cite, and the
 * collapsible Sources panel. Owns the citation→chunk interaction: clicking a
 * citation expands the panel and highlights the source chunk it points at.
 */
export function AnswerView({ result }: { result: QueryResult }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);

  const grounded = result.citations.length > 0;

  // Citation numbers (1-based, by citation order) grouped per chunk index.
  const citeNumbersByChunk = useMemo(() => {
    const byChunk: number[][] = result.chunks.map(() => []);
    result.citations.forEach((c, i) => {
      byChunk[c.documentIndex]?.push(i + 1);
    });
    return byChunk;
  }, [result]);

  function activate(documentIndex: number) {
    setSourcesOpen(true);
    setHighlighted(documentIndex);
  }

  return (
    <div className="answer-view">
      <AnswerBody answer={result.answer} />

      {grounded && <CitationList citations={result.citations} onActivate={activate} />}

      {!result.citationsSupported && <CapabilityNote />}

      {result.chunks.length > 0 && (
        <SourcesPanel
          chunks={result.chunks}
          citeNumbersByChunk={citeNumbersByChunk}
          grounded={grounded}
          open={sourcesOpen}
          onToggle={() => setSourcesOpen((o) => !o)}
          highlightedIndex={sourcesOpen ? highlighted : null}
        />
      )}
    </div>
  );
}
