import { useSyncExternalStore } from 'react';

/**
 * Light and dark for the app. The choice rides on the `dark` class on <html> that
 * tokens.css keys off, so everything under it switches with it.
 */
export type Theme = 'light' | 'dark';
/** What the user picked; `system` follows the OS setting. */
export type ThemeChoice = Theme | 'system';

const KEY = 'gg-theme';
/** The canvas's key before the apps shared one setting; moved to KEY on first read. */
const LEGACY_KEY = 'v2-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();
let watchingSystem = false;

/** Light unless the user has picked dark or system; a stored choice always wins. */
export function readThemeChoice(): ThemeChoice {
  try {
    let stored = localStorage.getItem(KEY);
    if (stored === null) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        localStorage.setItem(KEY, legacy);
        localStorage.removeItem(LEGACY_KEY);
        stored = legacy;
      }
    }
    return stored === 'dark' || stored === 'system' ? stored : 'light';
  } catch {
    return 'light';
  }
}

function systemIsDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

function resolve(choice: ThemeChoice): Theme {
  if (choice === 'system') return systemIsDark() ? 'dark' : 'light';
  return choice;
}

function read(): Theme {
  return resolve(readThemeChoice());
}

function paint(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function applyTheme(choice: ThemeChoice): void {
  paint(resolve(choice));
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: the choice lasts the session */
  }
  for (const l of listeners) l();
}

/** Put the saved choice on <html> before first paint, and follow the OS while it is `system`. */
export function initTheme(): void {
  paint(read());
  if (watchingSystem || typeof window.matchMedia !== 'function') return;
  watchingSystem = true;
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (readThemeChoice() !== 'system') return;
    paint(read());
    for (const l of listeners) l();
  });
}

/** Flip between light and dark from whatever shows now. */
export function toggleTheme(): void {
  applyTheme(read() === 'dark' ? 'light' : 'dark');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, read, () => 'light' as Theme);
  return [theme, toggleTheme];
}
