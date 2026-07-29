import type { QueryResult } from './types';

/**
 * The app is a query flow with a persisted history of past questions
 * (decision 2026-07-29 — revisits the guide §8 "no history persistence"
 * deferral; recorded there). State is a small reducer (design guide §9):
 * a list of `Exchange`es (newest first) + which one is on screen.
 *
 * The §6 render branches are *derived* from the active exchange (`phaseOf`),
 * not stored — state keeps the `QueryResult`, components read it directly.
 */
export interface QueryError {
  message: string;
  correlationId?: string;
}

/** One question and its outcome (in flight, answered, or failed). */
export interface Exchange {
  id: string;
  question: string;
  createdAt: number;
  pending: boolean;
  result: QueryResult | null;
  error: QueryError | null;
}

export interface AppState {
  /** Newest first. */
  history: Exchange[];
  /** The exchange currently shown; null → EmptyState. */
  activeId: string | null;
}

export type Phase = 'empty' | 'loading' | 'answered' | 'abstained' | 'error';

/** Render branch for the active exchange (guide §6), derived not stored. */
export function phaseOf(ex: Exchange | null): Phase {
  if (!ex) return 'empty';
  if (ex.pending) return 'loading';
  if (ex.error) return 'error';
  if (ex.result?.abstained) return 'abstained';
  return 'answered';
}

export function activeExchange(state: AppState): Exchange | null {
  return state.history.find((e) => e.id === state.activeId) ?? null;
}

// --- Persistence (localStorage) ---------------------------------------------

const HISTORY_KEY = 'rag-history';
const MAX_HISTORY = 50;

/** Only completed, successful exchanges are persisted (no pending/errors). */
export function loadHistory(): Exchange[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Exchange[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.question === 'string' && e.result != null)
      .map((e) => ({ ...e, pending: false, error: null }))
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

export function saveHistory(history: Exchange[]): void {
  try {
    const persistable = history.filter((e) => e.result != null && !e.pending).slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(persistable));
  } catch {
    /* storage unavailable (private mode) — history is session-only this run */
  }
}

export function init(): AppState {
  return { history: loadHistory(), activeId: null };
}

export type Action =
  | { type: 'submit'; id: string; question: string }
  | { type: 'success'; id: string; result: QueryResult }
  | { type: 'failure'; id: string; error: QueryError }
  | { type: 'select'; id: string }
  | { type: 'newChat' }
  | { type: 'remove'; id: string }
  | { type: 'clear' };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'submit': {
      const ex: Exchange = {
        id: action.id,
        question: action.question,
        createdAt: Date.now(),
        pending: true,
        result: null,
        error: null,
      };
      return { history: [ex, ...state.history], activeId: action.id };
    }
    case 'success':
      return {
        ...state,
        history: state.history.map((e) =>
          e.id === action.id ? { ...e, pending: false, result: action.result, error: null } : e,
        ),
      };
    case 'failure':
      return {
        ...state,
        history: state.history.map((e) =>
          e.id === action.id ? { ...e, pending: false, error: action.error, result: null } : e,
        ),
      };
    case 'select':
      return { ...state, activeId: action.id };
    case 'newChat':
      return { ...state, activeId: null };
    case 'remove': {
      const history = state.history.filter((e) => e.id !== action.id);
      return { history, activeId: state.activeId === action.id ? null : state.activeId };
    }
    case 'clear':
      return { history: [], activeId: null };
  }
}
