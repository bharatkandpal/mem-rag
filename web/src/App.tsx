import { useState, type FormEvent } from 'react';
import { fetchQuery, QueryError } from './api';
import type { QueryResult } from './types';

/**
 * GO-21e-b scaffold shell — a deliberately minimal harness that proves the
 * `/query` contract end-to-end in dev (composer → `fetchQuery` → render the
 * raw result). The real citation-first UI (AppShell, tokens, the four render
 * branches) is built on top of this in GO-21e-c…h; this component is expected
 * to be replaced, not extended.
 */

type Status = 'idle' | 'loading' | 'done' | 'error';

export default function App() {
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || status === 'loading') return;

    setStatus('loading');
    setError(null);
    setResult(null);
    try {
      setResult(await fetchQuery(q));
      setStatus('done');
    } catch (err) {
      const suffix =
        err instanceof QueryError && err.correlationId ? ` (trace: ${err.correlationId})` : '';
      setError(`${err instanceof Error ? err.message : String(err)}${suffix}`);
      setStatus('error');
    }
  }

  return (
    <main className="shell">
      <header>
        <h1>RAG · knowledge-store chat</h1>
        <p className="scaffold-note">
          GO-21e-b scaffold — verifies the <code>/query</code> contract in dev. The designed UI
          lands in GO-21e-c…h.
        </p>
      </header>

      <form className="composer" onSubmit={onSubmit}>
        <input
          type="text"
          value={question}
          placeholder="Ask a question about the corpus…"
          onChange={(e) => setQuestion(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={status === 'loading' || !question.trim()}>
          {status === 'loading' ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {status === 'error' && <p className="error">{error}</p>}

      {status === 'done' && result && (
        <section className="result">
          <p className="badges">
            {result.abstained && <span className="badge info">abstained</span>}
            {result.grounded && <span className="badge ok">grounded</span>}
            {!result.citationsSupported && (
              <span className="badge warn">citations unsupported</span>
            )}
            <span className="badge">
              {result.citations.length} citation{result.citations.length === 1 ? '' : 's'}
            </span>
            <span className="badge">
              {result.chunks.length} chunk{result.chunks.length === 1 ? '' : 's'}
            </span>
          </p>
          <p className="answer">{result.answer}</p>
          <pre className="raw">{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
