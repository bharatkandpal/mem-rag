import { useCallback, useEffect, useReducer, useState } from 'react';
import { AppShell } from './components/AppShell';
import { EmptyState } from './components/EmptyState';
import { HistoryDrawer } from './components/HistoryDrawer';
import { Conversation } from './components/Conversation';
import { fetchQuery, QueryError } from './api';
import { activeExchange, init, phaseOf, reducer, saveHistory } from './state';

/**
 * Wires the AppShell + a persisted history of questions (decision 2026-07-29,
 * guide §2/§8) around a `useReducer` query flow. GO-21e-d renders the query
 * happy path via `Conversation`; the designed abstain/error cards (GO-21e-e)
 * and citation markers + `SourcesPanel` (GO-21e-f) land next.
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
          <Conversation exchange={active} phase={phase} />
        )}
      </AppShell>
    </>
  );
}
