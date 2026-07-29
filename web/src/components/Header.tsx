import { StatusBadge } from './StatusBadge';
import { ThemeToggle } from './ThemeToggle';
import type { Theme } from '../hooks/useTheme';
import './Header.css';

interface HeaderProps {
  citationsSupported: boolean | null;
  theme: Theme;
  onToggleTheme: () => void;
}

/** App header: product name, provider capability badge, theme toggle (§2). */
export function Header({ citationsSupported, theme, onToggleTheme }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
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
