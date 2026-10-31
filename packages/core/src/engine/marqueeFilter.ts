// What a marquee may pick when the status bar's chip says "This tab's kind".
//
// The dock tab is the editor's own view state (it lives in the canvas shell, not the
// store), so the shell hands a provider here and the Select tool asks it on release.

import type { SelectionKind } from '../store/selectionResolve';

/** Each dock tab's kinds (decision 0.2.8). */
export const TAB_KINDS: Record<string, readonly SelectionKind[]> = {
  floors: ['shape', 'water'],
  walls: ['wall', 'door'],
  rooms: ['room'],
  props: ['asset'],
  assets: ['asset'],
  lights: ['light'],
  labels: ['text', 'zone'],
};

let provider: (() => readonly SelectionKind[] | null) | null = null;

/** Installs (or with null, removes) the source of the active tab's kinds. */
export function setMarqueeKinds(fn: (() => readonly SelectionKind[] | null) | null): void {
  provider = fn;
}

/** The kinds the active tab picks, or null when the tab is unknown (everything). */
export function marqueeTabKinds(): readonly SelectionKind[] | null {
  return provider?.() ?? null;
}
