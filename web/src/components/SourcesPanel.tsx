import { useEffect, useRef } from 'react';
import { ChevronRight, CircleCheck } from 'lucide-react';
import type { RetrievedChunk } from '../types';
import { ChunkRow } from './ChunkRow';
import './SourcesPanel.css';

interface SourcesPanelProps {
  chunks: RetrievedChunk[];
  /** Per-chunk citation numbers (index-aligned to `chunks`). */
  citeNumbersByChunk: number[][];
  /** True when ≥1 citation — drives the "grounded ✓" badge. */
  grounded: boolean;
  open: boolean;
  onToggle: () => void;
  /** Chunk index to highlight + scroll to (from a citation click); null = none. */
  highlightedIndex: number | null;
}

/**
 * Collapsible retrieved-chunks panel — the "receipts" (design guide §5).
 * Collapsed by default; lists every `chunks[]` entry with source + score, so a
 * viewer sees both what was cited and what was retrieved-but-not-cited.
 */
export function SourcesPanel({
  chunks,
  citeNumbersByChunk,
  grounded,
  open,
  onToggle,
  highlightedIndex,
}: SourcesPanelProps) {
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (open && highlightedIndex != null) {
      rowRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightedIndex]);

  return (
    <section className="sources">
      <button type="button" className="sources__toggle" onClick={onToggle} aria-expanded={open}>
        <ChevronRight
          className={`sources__chevron${open ? ' sources__chevron--open' : ''}`}
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="sources__label">Sources ({chunks.length})</span>
        {grounded && (
          <span className="sources__grounded">
            <CircleCheck size={14} strokeWidth={2} aria-hidden="true" />
            grounded
          </span>
        )}
      </button>
      {open && (
        <ul className="sources__list">
          {chunks.map((chunk, i) => (
            <ChunkRow
              key={i}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              chunk={chunk}
              citeNumbers={citeNumbersByChunk[i] ?? []}
              highlighted={highlightedIndex === i}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
