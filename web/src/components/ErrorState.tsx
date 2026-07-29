import { RotateCw, TriangleAlert } from 'lucide-react';
import './ErrorState.css';

interface ErrorStateProps {
  message: string;
  /** Request correlation id from the server error body (RAG-63), if any. */
  correlationId?: string;
  onRetry: () => void;
}

/**
 * The genuine-failure state (design guide §6, §9) — the ONLY red state.
 * Network/5xx only; carries a retry and the correlation id so a failed answer
 * is traceable end-to-end. Abstain and no-citation-support are NOT errors and
 * never render here.
 */
export function ErrorState({ message, correlationId, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <span className="error-state__icon" aria-hidden="true">
        <TriangleAlert size={18} strokeWidth={1.5} />
      </span>
      <div className="error-state__body">
        <p className="error-state__title">Something went wrong</p>
        <p className="error-state__text">{message}</p>
        {correlationId && (
          <p className="error-state__trace">
            trace: <code>{correlationId}</code>
          </p>
        )}
        <button type="button" className="error-state__retry" onClick={onRetry}>
          <RotateCw size={15} strokeWidth={2} />
          Retry
        </button>
      </div>
    </div>
  );
}
