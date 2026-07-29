import { useEffect, useRef } from 'react';
import type { Exchange, Phase } from '../state';
import { Message } from './Message';
import { AnswerBody } from './AnswerBody';
import { LoadingAnswer } from './LoadingAnswer';
import { AbstainCard } from './AbstainCard';
import { CapabilityNote } from './CapabilityNote';
import { ErrorState } from './ErrorState';
import './Conversation.css';

interface ConversationProps {
  exchange: Exchange;
  phase: Phase;
  /** Re-run a failed exchange in place. */
  onRetry: (id: string, question: string) => void;
}

/**
 * The active exchange rendered as a user turn + the assistant's reply
 * (design guide §2, §6). GO-21e-d built loading + answer; GO-21e-e adds the
 * honest states — `AbstainCard` (calm, not an error), `CapabilityNote` (when
 * the provider can't cite), and `ErrorState` (the only red state, with retry).
 * Citation markers + `SourcesPanel` arrive in GO-21e-f.
 */
export function Conversation({ exchange, phase, onRetry }: ConversationProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the latest turn in view as it changes (loading → answer, or on select).
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [exchange.id, phase]);

  const result = exchange.result;

  return (
    <div className="conversation">
      <Message role="user">{exchange.question}</Message>
      <Message role="assistant">
        {phase === 'loading' && <LoadingAnswer />}

        {phase === 'abstained' && result && <AbstainCard message={result.answer} />}

        {phase === 'answered' && result && (
          <>
            <AnswerBody answer={result.answer} />
            {!result.citationsSupported && <CapabilityNote />}
          </>
        )}

        {phase === 'error' && exchange.error && (
          <ErrorState
            message={exchange.error.message}
            correlationId={exchange.error.correlationId}
            onRetry={() => onRetry(exchange.id, exchange.question)}
          />
        )}
      </Message>
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}
