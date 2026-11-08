import { useSyncExternalStore } from 'react';

/** The View menu's UI scale steps, in percent of the browser's own text size. */
export const UI_SCALES = [90, 100, 115] as const;
export type UiScale = (typeof UI_SCALES)[number];

const KEY = 'gg.table.uiScale';
const listeners = new Set<() => void>();

export function readUiScale(): UiScale {
  try {
    const n = Number(localStorage.getItem(KEY));
    return (UI_SCALES as readonly number[]).includes(n) ? (n as UiScale) : 100;
  } catch {
    return 100;
  }
}

function paint(scale: UiScale): void {
  // Every size in the chrome is in rem, so the root size scales all of it at once.
  document.documentElement.style.fontSize = scale === 100 ? '' : `${scale}%`;
}

export function applyUiScale(scale: UiScale): void {
  paint(scale);
  try {
    localStorage.setItem(KEY, String(scale));
  } catch {
    /* private mode: the scale lasts the session */
  }
  for (const l of listeners) l();
}

/** Put the saved scale on <html> before first paint. */
export function initUiScale(): void {
  paint(readUiScale());
}

export function useUiScale(): UiScale {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readUiScale,
    () => 100 as UiScale,
  );
}
