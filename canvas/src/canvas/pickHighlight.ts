// The object a "Pick from here" row is pointing at: the row sets it on hover (and focus) and
// clears it on leaving or when the menu closes; the link overlay (`linkOverlay.ts`) outlines it
// on the canvas. Editor view state, never in the store or the map.

type Listener = () => void;

let current: string | null = null;
const listeners = new Set<Listener>();

/** Outline object `id` on the canvas, or nothing with null. */
export function setPickHighlight(id: string | null): void {
  if (current === id) return;
  current = id;
  for (const fn of listeners) fn();
}

export function getPickHighlight(): string | null {
  return current;
}

/** Called on every change; returns the unsubscribe. */
export function subscribePickHighlight(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
