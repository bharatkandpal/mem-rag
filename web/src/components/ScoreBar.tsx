import './ScoreBar.css';

/** Visual 0–1 similarity bar with the numeric score (design guide §4). */
export function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score)) * 100;
  return (
    <span className="score-bar" title={`cosine similarity ${score.toFixed(3)}`}>
      <span className="score-bar__track">
        <span className="score-bar__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="score-bar__value">{score.toFixed(2)}</span>
    </span>
  );
}
