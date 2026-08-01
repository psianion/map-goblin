import { create } from 'zustand';

/**
 * The table's transient feedback channel. One toast at a time (D9: single DM in V1), so
 * this is a slot rather than a queue — a second toast replaces the first, which is exactly
 * what you want when the newer thing is the thing you just did.
 *
 * Two callers so far: the undo window after a bulk fog change, and the refusal when
 * somebody pulls a locked door. Both go through this, never a modal — a dialog mid-play
 * stops the game to ask a question nobody wanted asked.
 *
 * Repeating the message already on screen is not a second toast; it renews the one that is
 * there. That belongs here rather than in each caller — see `show`.
 */

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface Toast {
  /**
   * The dismissal key, so a stale timer cannot close a newer toast. Monotonic across
   * *distinct* toasts; a repeat of the same message keeps its id, because it is the same
   * toast standing for longer rather than a second one.
   */
  id: number;
  message: string;
  action?: ToastAction;
  /** How long the toast — and with it, the action — stays available. */
  durationMs: number;
}

export type ToastSpec = Omit<Toast, 'id' | 'durationMs'> & { durationMs?: number };

/** Long enough to read a refusal, short enough not to sit on the map. */
export const DEFAULT_TOAST_MS = 5000;
/** D9 — the undo window after Reveal All / Hide All. Spec'd separately; do not fold in. */
export const UNDO_TOAST_MS = 5000;

interface ToastStore {
  toast: Toast | null;
  show: (spec: ToastSpec) => number;
  /** Without an id, dismisses whatever is showing; with one, only that toast. */
  dismiss: (id?: number) => void;
}

let nextId = 0;

export const useToasts = create<ToastStore>()((set, get) => ({
  toast: null,
  show: (spec) => {
    // Repeating the words already on screen keeps the same toast — but *refreshes* it, and
    // that is the whole point. A refused drag is refused at ~10 Hz on the way across and
    // again on the drop, and the callers used to drop the repeats on the floor. So the
    // clock started at the first refusal, fired mid-gesture while the player was still
    // looking at their pointer: by the time they let go and read the map, the toast had a
    // second left on it, or had already gone. Re-setting it restarts the timer in `ToastHost`
    // (which keys on the object), so the window runs from the refusal the player saw.
    const current = get().toast;
    const id = current?.message === spec.message ? current.id : (nextId += 1);
    set({ toast: { durationMs: DEFAULT_TOAST_MS, ...spec, id } });
    return id;
  },
  dismiss: (id) => {
    if (id === undefined || get().toast?.id === id) set({ toast: null });
  },
}));

/** Imperative entry points — modules raise toasts from event handlers, not from render. */
export const showToast = (spec: ToastSpec): number => useToasts.getState().show(spec);
export const dismissToast = (id?: number): void => useToasts.getState().dismiss(id);
