import { Sparkles } from 'lucide-react';
import './EmptyState.css';

interface EmptyStateProps {
  onPick: (question: string) => void;
  disabled?: boolean;
}

// Seed the <60s-to-first-answer path (guide §1) with real corpus questions
// (drawn from eval/dataset.jsonl over eval/sample-corpus).
const EXAMPLES = [
  'How is retrieval scored?',
  'What embedding model does this project use by default?',
  'What happens when retrieval finds no chunks above the score floor?',
];

/** First-load intro + example questions (design guide §4). */
export function EmptyState({ onPick, disabled = false }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        <Sparkles size={22} strokeWidth={1.5} />
      </span>
      <h1 className="empty-state__title">Ask the corpus anything</h1>
      <p className="empty-state__lead">
        Answers are grounded in retrieved documents and cite their sources. If the answer isn’t in
        the corpus, it says so rather than guessing.
      </p>
      <div className="empty-state__examples" role="list" aria-label="Example questions">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            role="listitem"
            className="empty-state__chip"
            onClick={() => onPick(q)}
            disabled={disabled}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
