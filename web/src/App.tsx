import { useCallback, useReducer } from 'react';
import { AppShell } from './components/AppShell';
import { EmptyState } from './components/EmptyState';
import { fetchQuery, QueryError } from './api';
import { initialState, reducer } from './state';
import './interim.css';

/**
 * GO-21e-c wires the AppShell (tokens, header, composer, empty state) around a
 * `useReducer` query flow. The designed Conversation / AnswerBody / SourcesPanel
 * and the four state cards land in GO-21e-d…f; until then the non-empty phases
 * render the clearly-marked interim view below so the flow stays functional.
 */
export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const submit = useCallback(async (question: string) => {
    dispatch({ type: 'submit', question });
    try {
      dispatch({ type: 'success', result: await fetchQuery(question) });
    } catch (err) {
      dispatch({
        type: 'failure',
        error:
          err instanceof QueryError
            ? { message: err.message, correlationId: err.correlationId }
            : { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }, []);

  const citationsSupported = state.result?.citationsSupported ?? null;

  return (
    <AppShell
      citationsSupported={citationsSupported}
      onSubmit={submit}
      busy={state.phase === 'loading'}
    >
      {state.phase === 'empty' ? <EmptyState onPick={submit} /> : <InterimResult state={state} />}
    </AppShell>
  );
}

/** Placeholder result view — replaced by the designed components in GO-21e-d…f. */
function InterimResult({ state }: { state: ReturnType<typeof reducer> }) {
  return (
    <div className="interim">
      {state.question && <p className="interim__question">{state.question}</p>}

      {state.phase === 'loading' && <p className="interim__meta">Retrieving &amp; generating…</p>}

      {(state.phase === 'answered' || state.phase === 'abstained') && state.result && (
        <>
          <p className="interim__answer">{state.result.answer}</p>
          <p className="interim__meta">
            {state.phase === 'abstained' ? 'abstained · ' : ''}
            {state.result.citations.length} citation
            {state.result.citations.length === 1 ? '' : 's'} · {state.result.chunks.length} chunk
            {state.result.chunks.length === 1 ? '' : 's'}
            {!state.result.citationsSupported && ' · citations unsupported'}
          </p>
        </>
      )}

      {state.phase === 'error' && state.error && (
        <p className="interim__error">
          {state.error.message}
          {state.error.correlationId ? ` (trace: ${state.error.correlationId})` : ''}
        </p>
      )}
    </div>
  );
}
