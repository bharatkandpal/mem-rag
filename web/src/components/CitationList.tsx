import * as Popover from '@radix-ui/react-popover';
import type { Citation } from '../types';
import './CitationList.css';

interface CitationListProps {
  citations: Citation[];
  /** Clicking a citation expands + highlights the matching chunk in Sources. */
  onActivate: (documentIndex: number) => void;
}

/**
 * The numbered citations, grouped beneath the answer (decision 2026-07-29 —
 * UI-only, grouped rather than inline-at-span, since the contract doesn't carry
 * answer offsets). Each is a keyboard-focusable button that opens an accessible
 * Radix popover with the exact `citedText` + source, and on click expands +
 * highlights the source chunk (design guide §5).
 */
export function CitationList({ citations, onActivate }: CitationListProps) {
  return (
    <div className="citations" aria-label="Citations">
      {citations.map((c, i) => (
        <Popover.Root key={i}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="citations__chip"
              onClick={() => onActivate(c.documentIndex)}
              aria-label={`Citation ${i + 1}, source ${c.source}`}
            >
              <sup className="citations__num">{i + 1}</sup>
              <span className="citations__source">{c.source}</span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="citation-popover" sideOffset={6} collisionPadding={12}>
              <blockquote className="citation-popover__quote">“{c.citedText}”</blockquote>
              <span className="citation-popover__source">{c.source}</span>
              <Popover.Arrow className="citation-popover__arrow" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ))}
    </div>
  );
}
