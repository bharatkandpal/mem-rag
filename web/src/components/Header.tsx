import { Menu } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { ThemeToggle } from './ThemeToggle';
import type { Theme } from '../hooks/useTheme';
import './Header.css';

interface HeaderProps {
  citationsSupported: boolean | null;
  theme: Theme;
  onToggleTheme: () => void;
  onToggleHistory: () => void;
  historyOpen: boolean;
}

/** App header: history toggle, product name, capability badge, theme toggle (§2). */
export function Header({
  citationsSupported,
  theme,
  onToggleTheme,
  onToggleHistory,
  historyOpen,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <button
          type="button"
          className="app-header__burger"
          onClick={onToggleHistory}
          aria-label="Toggle question history"
          aria-expanded={historyOpen}
          title="Question history"
        >
          <Menu size={20} strokeWidth={1.5} />
        </button>
        <span className="app-header__mark" aria-hidden="true">
          ◇
        </span>
        <span className="app-header__title">
          RAG <span className="app-header__sub">· knowledge-store chat</span>
        </span>
      </div>
      <div className="app-header__actions">
        <StatusBadge citationsSupported={citationsSupported} />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </header>
  );
}
