/**
 * Rail item DOM nodes, keyed by panel id. `Popover` reads these to anchor itself to the icon
 * that opened it — a module-level map rather than a context/ref-forwarding dance, since the
 * two components are siblings under the same shell and neither needs the other's re-renders.
 *
 * Its own file rather than living in `Rail.tsx`: a component file that also exports a plain
 * value trips `react-refresh/only-export-components` (Fast Refresh can't hot-reload it).
 */
export const railRefs = new Map<string, HTMLButtonElement>();
