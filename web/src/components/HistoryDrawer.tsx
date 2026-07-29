import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { Exchange } from '../state';
import { relativeTime } from '../lib/time';
import './HistoryDrawer.css';

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  history: Exchange[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

/**
 * Collapsible left history drawer (decision 2026-07-29). Collapsed by default
 * — toggled by the header burger — so the single-column, citation-first focus
 * stays intact (guide §2). Overlays the shell; backdrop + Esc close it.
 */
export function HistoryDrawer({
  open,
  onClose,
  history,
  activeId,
  onSelect,
  onNewChat,
  onRemove,
  onClear,
}: HistoryDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus into the panel when it opens (basic a11y; full pass in GO-21e-h).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className={`history ${open ? 'history--open' : ''}`} aria-hidden={!open}>
      <div className="history__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className="history__panel"
        role="dialog"
        aria-label="Question history"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="history__head">
          <span className="history__title">History</span>
          <div className="history__head-actions">
            {history.length > 0 && (
              <button
                type="button"
                className="history__icon-btn"
                onClick={onClear}
                title="Clear all history"
                aria-label="Clear all history"
              >
                <Trash2 size={16} strokeWidth={1.5} />
              </button>
            )}
            <button
              type="button"
              className="history__icon-btn"
              onClick={onClose}
              title="Close history"
              aria-label="Close history"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <button type="button" className="history__new" onClick={onNewChat}>
          <Plus size={16} strokeWidth={2} />
          New question
        </button>

        {history.length === 0 ? (
          <p className="history__empty">No questions yet. Ask one to start your history.</p>
        ) : (
          <ul className="history__list">
            {history.map((ex) => (
              <li key={ex.id}>
                <button
                  type="button"
                  className={`history__item ${ex.id === activeId ? 'history__item--active' : ''}`}
                  onClick={() => onSelect(ex.id)}
                  aria-current={ex.id === activeId ? 'true' : undefined}
                >
                  <span className="history__q">{ex.question}</span>
                  <span className="history__meta">
                    {ex.pending ? 'asking…' : ex.error ? 'failed' : relativeTime(ex.createdAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="history__remove"
                  onClick={() => onRemove(ex.id)}
                  title="Remove from history"
                  aria-label={`Remove "${ex.question}" from history`}
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
