import type { QueryResult } from './types';

/**
 * The app is one query flow, so its state is a small reducer (design guide §9).
 * GO-21e-c establishes the shape + transitions; GO-21e-d…f render each branch.
 *
 * The `phase` maps onto the §6 render branches — `answered` is split into its
 * grounded / uncited sub-cases at render time from the `QueryResult`, not here.
 */
export type Phase = 'empty' | 'loading' | 'answered' | 'abstained' | 'error';

export interface QueryError {
  message: string;
  correlationId?: string;
}

export interface AppState {
  phase: Phase;
  /** The question currently submitted / in flight / answered. */
  question: string | null;
  /** The last successful result (answered or abstained). */
  result: QueryResult | null;
  /** The last error (phase === 'error'). */
  error: QueryError | null;
}

export const initialState: AppState = {
  phase: 'empty',
  question: null,
  result: null,
  error: null,
};

export type Action =
  | { type: 'submit'; question: string }
  | { type: 'success'; result: QueryResult }
  | { type: 'failure'; error: QueryError }
  | { type: 'reset' };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'submit':
      return { phase: 'loading', question: action.question, result: null, error: null };
    case 'success':
      return {
        ...state,
        phase: action.result.abstained ? 'abstained' : 'answered',
        result: action.result,
        error: null,
      };
    case 'failure':
      return { ...state, phase: 'error', result: null, error: action.error };
    case 'reset':
      return initialState;
  }
}
