import { SearchX } from 'lucide-react';
import './AbstainCard.css';

/**
 * The "not in the corpus" state (design guide §6). Calm and informational —
 * `--info`, never `--danger`: abstaining is the product being trustworthy, not
 * a failure. Shows the verbatim abstain message; no citations, no sources.
 */
export function AbstainCard({ message }: { message: string }) {
  return (
    <div className="abstain" role="note">
      <span className="abstain__icon" aria-hidden="true">
        <SearchX size={18} strokeWidth={1.5} />
      </span>
      <div className="abstain__body">
        <p className="abstain__title">Not in the corpus</p>
        <p className="abstain__text">{message}</p>
      </div>
    </div>
  );
}
