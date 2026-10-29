// The World panel's two client-only values, read by the table's renderer sync:
//
//  - "Show me everything lit" (`dmLit`): the DM's own view drawn with no darkness, every
//    region Lit and no darkness masks. Players and the referee never see it. Remembered per
//    browser.
//  - The darkness slider while it is being dragged (`darknessPreview`): the DM's view eases to
//    the thumb before anything is sent; the release commits `set-world {darkness}` once.
//
// A tiny store each, with a hook for the panel and plain getters for the sync (worldSync.ts
// reads `dmLit()` and `getDarknessPreview()` and re-installs its frame on `subscribeWorldPrefs`).

import { useSyncExternalStore } from 'react';

export const DM_LIT_KEY = 'gg-dm-lit';

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = (): void => {
  for (const l of listeners) l();
};
const subscribe = (l: Listener): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let lit: boolean | null = null;
let darknessPreview: number | null = null;

/** Whether the DM asked to see everything lit. Off unless turned on. */
export function dmLit(): boolean {
  if (lit === null) {
    try {
      lit = localStorage.getItem(DM_LIT_KEY) === '1';
    } catch {
      lit = false;
    }
  }
  return lit;
}

export function setDmLit(on: boolean): void {
  if (dmLit() === on) return;
  lit = on;
  try {
    localStorage.setItem(DM_LIT_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the choice lasts the session */
  }
  emit();
}

/** The slider value under the DM's thumb while dragging, else null. */
export const getDarknessPreview = (): number | null => darknessPreview;

export function setDarknessPreview(value: number | null): void {
  if (darknessPreview === value) return;
  darknessPreview = value;
  emit();
}

/** Subscribe to either value changing (the renderer sync re-installs its frame). */
export const subscribeWorldPrefs = subscribe;

export function useDmLit(): boolean {
  return useSyncExternalStore(subscribe, dmLit, () => false);
}

export function useDarknessPreview(): number | null {
  return useSyncExternalStore(subscribe, getDarknessPreview, () => null);
}

/** Tests only. */
export function resetWorldPrefsForTests(): void {
  lit = null;
  darknessPreview = null;
}
