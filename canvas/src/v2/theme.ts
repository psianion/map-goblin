import { useCallback, useSyncExternalStore } from 'react';

/**
 * Light and dark for the v2 route. The choice rides on the same `dark` class on <html>
 * the v1 tokens key off, so the editor under the home page switches with it.
 */
export type Theme = 'light' | 'dark';

const KEY = 'v2-theme';
const listeners = new Set<() => void>();

/** Light unless the DM has picked dark; a stored choice always wins. */
function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice lasts the session */
  }
  for (const l of listeners) l();
}

/** Put the saved choice on <html> before first paint. */
export function initTheme(): void {
  document.documentElement.classList.toggle('dark', read() === 'dark');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, read, () => 'light' as Theme);
  const toggle = useCallback(() => applyTheme(read() === 'dark' ? 'light' : 'dark'), []);
  return [theme, toggle];
}
