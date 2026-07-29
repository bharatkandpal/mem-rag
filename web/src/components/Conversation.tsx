import { useEffect, useRef } from 'react';
import type { Exchange, Phase } from '../state';
import { Message } from './Message';
import { AnswerBody } from './AnswerBody';
import { LoadingAnswer } from './LoadingAnswer';
import './Conversation.css';

/**
 * The active exchange rendered as a user turn + the assistant's reply
 * (design guide §2). GO-21e-d covers the happy path (answer) + loading; the
 * abstain and error branches are rendered minimally here and get their
 * designed cards (`AbstainCard`, `ErrorState`) in GO-21e-e; citations markers +
 * `SourcesPanel` arrive in GO-21e-f.
 */
export function Conversation({ exchange, phase }: { exchange: Exchange; phase: Phase }) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the latest turn in view as it changes (loading → answer, or on select).
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [exchange.id, phase]);

  return (
    <div className="conversation">
      <Message role="user">{exchange.question}</Message>
      <Message role="assistant">
        {phase === 'loading' && <LoadingAnswer />}

        {(phase === 'answered' || phase === 'abstained') && exchange.result && (
          <AnswerBody answer={exchange.result.answer} />
        )}

        {phase === 'error' && exchange.error && (
          <p className="conversation__error-interim">
            {exchange.error.message}
            {exchange.error.correlationId ? ` (trace: ${exchange.error.correlationId})` : ''}
          </p>
        )}
      </Message>
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}
