import './StatusBadge.css';

/**
 * Honest provider-capability badge (design guide §3, RAG-62). Driven by
 * `citationsSupported` from the last `QueryResult`:
 *   - `true`  → green dot, "citations on"
 *   - `false` → info (not red) dot, "no citations" — the provider just can't
 *               cite; the answer still stands
 *   - `null`  → neutral idle state before any query has run
 */
export function StatusBadge({ citationsSupported }: { citationsSupported: boolean | null }) {
  const variant =
    citationsSupported === null ? 'idle' : citationsSupported ? 'citations' : 'no-citations';
  const label =
    citationsSupported === null ? 'Ready' : citationsSupported ? 'Citations on' : 'No citations';
  const title =
    citationsSupported === false
      ? 'The configured provider can’t verify citations — answers are still grounded in retrieval.'
      : citationsSupported
        ? 'The provider returns verifiable citation spans.'
        : 'Ask a question to begin.';

  return (
    <span className={`status-badge status-badge--${variant}`} title={title}>
      <span className="status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
