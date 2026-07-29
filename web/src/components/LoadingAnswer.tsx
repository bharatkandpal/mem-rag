import './LoadingAnswer.css';

/**
 * Skeleton shown while `/query` is in flight (design guide §6, §8). Shimmer is
 * disabled under `prefers-reduced-motion` (global rule), leaving a static
 * skeleton. Sized near a short answer so the swap-in causes minimal shift.
 */
export function LoadingAnswer() {
  return (
    <div className="loading-answer" aria-label="Retrieving and generating the answer">
      <span className="loading-answer__line" style={{ width: '92%' }} />
      <span className="loading-answer__line" style={{ width: '100%' }} />
      <span className="loading-answer__line" style={{ width: '68%' }} />
    </div>
  );
}
