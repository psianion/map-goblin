/**
 * Rail item DOM nodes, keyed by panel id. `Popover` reads these to anchor itself to the icon
 * that opened it — a module-level map rather than a context/ref-forwarding dance, since the
 * two components are siblings under the same shell and neither needs the other's re-renders.
 *
 * `subscribe`/`getVersion` exist for one reason: `Popover` can mount (and a panel can already
 * be open) before `Rail` has registered any refs at all — a page refresh with a panel id
 * still in the URL, or a mount-order regression like M3 review finding 1. A version counter
 * bumped on every `set`/`delete`, read through `useSyncExternalStore`, is what tells Popover's
 * anchor effect to recompute the moment the icon it is waiting for shows up, instead of
 * sticking to whatever the fallback resolved on its own first render.
 *
 * Its own file rather than living in `Rail.tsx`: a component file that also exports a plain
 * value trips `react-refresh/only-export-components` (Fast Refresh can't hot-reload it).
 */
type Listener = () => void;

const refs = new Map<string, HTMLButtonElement>();
const listeners = new Set<Listener>();
let version = 0;

function notify(): void {
  version++;
  listeners.forEach((listener) => listener());
}

export const railRefs = {
  get: (id: string): HTMLButtonElement | undefined => refs.get(id),
  set: (id: string, el: HTMLButtonElement): void => {
    refs.set(id, el);
    notify();
  },
  delete: (id: string): void => {
    refs.delete(id);
    notify();
  },
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getVersion: (): number => version,
};
