import { useCallback, useEffect, useReducer, useState } from 'react';
import { AppShell } from './components/AppShell';
import { EmptyState } from './components/EmptyState';
import { HistoryDrawer } from './components/HistoryDrawer';
import { fetchQuery, QueryError } from './api';
import {
  activeExchange,
  init,
  phaseOf,
  reducer,
  saveHistory,
  type Exchange,
  type Phase,
} from './state';
import './interim.css';

/**
 * Wires the AppShell + a persisted history of questions (decision 2026-07-29,
 * guide §2/§8) around a `useReducer` query flow. The designed Conversation /
 * AnswerBody / SourcesPanel and the four state cards land in GO-21e-d…f; until
 * then the non-empty phases render the clearly-marked interim view below.
 */
export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Persist the history whenever it changes (completed exchanges only).
  useEffect(() => {
    saveHistory(state.history);
  }, [state.history]);

  const submit = useCallback(async (question: string) => {
    const id = crypto.randomUUID();
    dispatch({ type: 'submit', id, question });
    try {
      dispatch({ type: 'success', id, result: await fetchQuery(question) });
    } catch (err) {
      dispatch({
        type: 'failure',
        id,
        error:
          err instanceof QueryError
            ? { message: err.message, correlationId: err.correlationId }
            : { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }, []);

  const active = activeExchange(state);
  const phase = phaseOf(active);
  const citationsSupported = active?.result?.citationsSupported ?? null;

  return (
    <>
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        history={state.history}
        activeId={state.activeId}
        onSelect={(id) => {
          dispatch({ type: 'select', id });
          setHistoryOpen(false);
        }}
        onNewChat={() => {
          dispatch({ type: 'newChat' });
          setHistoryOpen(false);
        }}
        onRemove={(id) => dispatch({ type: 'remove', id })}
        onClear={() => dispatch({ type: 'clear' })}
      />
      <AppShell
        citationsSupported={citationsSupported}
        onSubmit={submit}
        busy={phase === 'loading'}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((o) => !o)}
      >
        {active === null ? (
          <EmptyState onPick={submit} />
        ) : (
          <InterimResult exchange={active} phase={phase} />
        )}
      </AppShell>
    </>
  );
}

/** Placeholder result view — replaced by the designed components in GO-21e-d…f. */
function InterimResult({ exchange, phase }: { exchange: Exchange; phase: Phase }) {
  const { question, result, error } = exchange;
  return (
    <div className="interim">
      <p className="interim__question">{question}</p>

      {phase === 'loading' && <p className="interim__meta">Retrieving &amp; generating…</p>}

      {(phase === 'answered' || phase === 'abstained') && result && (
        <>
          <p className="interim__answer">{result.answer}</p>
          <p className="interim__meta">
            {phase === 'abstained' ? 'abstained · ' : ''}
            {result.citations.length} citation{result.citations.length === 1 ? '' : 's'} ·{' '}
            {result.chunks.length} chunk{result.chunks.length === 1 ? '' : 's'}
            {!result.citationsSupported && ' · citations unsupported'}
          </p>
        </>
      )}

      {phase === 'error' && error && (
        <p className="interim__error">
          {error.message}
          {error.correlationId ? ` (trace: ${error.correlationId})` : ''}
        </p>
      )}
    </div>
  );
}
