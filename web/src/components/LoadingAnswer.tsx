import { useEffect, useState } from 'react';
import './LoadingAnswer.css';

// Local/self-hosted generation models can legitimately take 10-30s+ on CPU
// (vs. sub-second-to-a-few-seconds for a cloud API) — past this many seconds
// the static skeleton alone reads as frozen, so we say so explicitly.
const SLOW_HINT_AFTER_SECONDS = 8;

function statusFor(seconds: number): string {
  if (seconds < 2) return 'Retrieving context…';
  if (seconds < SLOW_HINT_AFTER_SECONDS) return 'Generating answer…';
  return 'Still generating — local models can take up to 30s…';
}

/**
 * Skeleton shown while `/query` is in flight (design guide §6, §8). A ticking
 * elapsed-time readout is what keeps a long wait from reading as "stuck" —
 * generation against a local model genuinely takes 10-30s+, and a skeleton
 * that never changes for that long is indistinguishable from a frozen UI.
 * Shimmer is disabled under `prefers-reduced-motion` (global rule); the timer
 * text still ticks, since that's information, not decoration.
 */
export function LoadingAnswer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    // A static label (not the ticking status) — this sits inside the assistant
    // Message's aria-live region, so a changing label would re-announce every
    // second. Screen readers hear this once; sighted users get the live timer.
    <div className="loading-answer" aria-label="Retrieving and generating the answer">
      <div className="loading-answer__skeleton" aria-hidden="true">
        <span className="loading-answer__line" style={{ width: '92%' }} />
        <span className="loading-answer__line" style={{ width: '100%' }} />
        <span className="loading-answer__line" style={{ width: '68%' }} />
      </div>
      <p className="loading-answer__status" aria-hidden="true">
        {statusFor(seconds)} <span className="loading-answer__timer">{seconds}s</span>
      </p>
    </div>
  );
}
