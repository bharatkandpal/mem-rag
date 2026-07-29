import type { ReactNode } from 'react';
import { Header } from './Header';
import { Composer } from './Composer';
import { useTheme } from '../hooks/useTheme';
import './AppShell.css';

interface AppShellProps {
  /** Provider citation capability for the header badge; null before any query. */
  citationsSupported: boolean | null;
  /** Submit a question (from the composer). */
  onSubmit: (question: string) => void;
  /** True while a query is in flight — disables the composer. */
  busy?: boolean;
  /** Whether the history drawer is open (drives the header burger's state). */
  historyOpen: boolean;
  /** Toggle the history drawer. */
  onToggleHistory: () => void;
  /** The scroll region: EmptyState, conversation, or a result branch. */
  children: ReactNode;
}

/**
 * Owns the theme and the three-row layout (guide §2): sticky header, a single
 * scrollable conversation column (max-width ~760px, §7), and a pinned composer.
 * The history drawer itself is rendered by `App` as a fixed overlay.
 */
export function AppShell({
  citationsSupported,
  onSubmit,
  busy = false,
  historyOpen,
  onToggleHistory,
  children,
}: AppShellProps) {
  const { theme, toggle } = useTheme();

  return (
    <div className="app-shell">
      <Header
        citationsSupported={citationsSupported}
        theme={theme}
        onToggleTheme={toggle}
        onToggleHistory={onToggleHistory}
        historyOpen={historyOpen}
      />
      <main className="app-shell__scroll" aria-live="polite">
        <div className="app-shell__column">{children}</div>
      </main>
      <div className="app-shell__composer">
        <div className="app-shell__column">
          <Composer onSubmit={onSubmit} disabled={busy} />
          <p className="app-shell__hint">
            Grounded, cited answers over your corpus · <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>{' '}
            to send
          </p>
        </div>
      </div>
    </div>
  );
}
