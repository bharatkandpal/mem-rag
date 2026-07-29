import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'rag-theme';

function initialTheme(): Theme {
  // The pre-paint script in index.html already resolved this onto <html>;
  // read it back so React state agrees with what's on screen.
  const onRoot = document.documentElement.dataset.theme;
  if (onRoot === 'light' || onRoot === 'dark') return onRoot;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Theme state, mirrored to `data-theme` on <html> and persisted to
 * localStorage. Defaults to the OS preference (design guide §3).
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable (private mode) — theme still applies for the session */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return { theme, toggle };
}
