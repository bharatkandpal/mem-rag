import './AnswerBody.css';

/**
 * Renders the answer text (design guide §4). GO-21e-d shows it plainly;
 * GO-21e-f replaces this with inline numbered citation markers aligned to
 * `citations[]` spans. Paragraphs split on blank lines; intra-paragraph
 * newlines are preserved.
 */
export function AnswerBody({ answer }: { answer: string }) {
  const paragraphs = answer.split(/\n{2,}/);
  return (
    <div className="answer">
      {paragraphs.map((p, i) => (
        <p key={i} className="answer__p">
          {p}
        </p>
      ))}
    </div>
  );
}
