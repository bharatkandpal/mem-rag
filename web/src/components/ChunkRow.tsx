import { forwardRef } from 'react';
import type { RetrievedChunk } from '../types';
import { ScoreBar } from './ScoreBar';
import './ChunkRow.css';

interface ChunkRowProps {
  chunk: RetrievedChunk;
  /** Citation numbers pointing at this chunk (empty = retrieved but not cited). */
  citeNumbers: number[];
  highlighted: boolean;
}

/** One retrieved chunk: mono source + citation markers + ScoreBar + snippet. */
export const ChunkRow = forwardRef<HTMLLIElement, ChunkRowProps>(function ChunkRow(
  { chunk, citeNumbers, highlighted },
  ref,
) {
  return (
    <li ref={ref} className={`chunk${highlighted ? ' chunk--highlighted' : ''}`}>
      <div className="chunk__head">
        <span className="chunk__source">{chunk.source}</span>
        {citeNumbers.length > 0 && (
          <span className="chunk__cites" aria-label={`cited as ${citeNumbers.join(', ')}`}>
            {citeNumbers.map((n) => (
              <sup key={n}>{n}</sup>
            ))}
          </span>
        )}
        <ScoreBar score={chunk.score} />
      </div>
      <p className="chunk__snippet">{chunk.content}</p>
    </li>
  );
});
