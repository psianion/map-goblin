import type { PathChild, PathPoint } from '@/store/types';

// The choices the Paths dock and the path card share.

export const PATH_END_CHOICES = [
  { value: 'cut' as const, label: 'Cut' },
  { value: 'fade' as const, label: 'Fade' },
  { value: 'taper' as const, label: 'Taper' },
];

export const PATH_EDGE_CHOICES = [
  { value: 'soft' as const, label: 'Soft' },
  { value: 'hard' as const, label: 'Hard' },
];

export const PATH_SORT_CHOICES = [
  { value: 'under' as const, label: 'Under', tip: 'Under props' },
  { value: 'over' as const, label: 'Over', tip: 'Over props' },
  { value: 'overhead' as const, label: 'Overhead', tip: 'Above tokens, like a bridge' },
];

export const PATH_HEIGHT_CHOICES = [
  { value: 'ground' as const, label: 'Ground', tip: 'Follows the ground under each point' },
  { value: 'set' as const, label: 'Set', tip: 'A height on each point' },
];

/** The map's crossing kinds, with Default (the material's own) first. */
export function crossingOptions(kinds: readonly { id: string; name: string }[]): { value: string; label: string }[] {
  return [{ value: '', label: 'Default' }, ...kinds.map((k) => ({ value: k.id, label: k.name }))];
}

/** The same path drawn the other way: points reversed, each point's handles swapped, the ends swapped. */
export function reversedPath(path: Pick<PathChild, 'points' | 'ends'>): Pick<PathChild, 'points' | 'ends'> {
  const points: PathPoint[] = [...path.points].reverse().map((p) =>
    p.handles ? { ...p, handles: { in: p.handles.out, out: p.handles.in } } : { ...p },
  );
  return { points, ends: { ...path.ends, start: path.ends.end, end: path.ends.start } };
}

/** Handles on: every point an auto curve. Off: every point a sharp corner. */
export function pathHandlesOn(path: Pick<PathChild, 'points'>): boolean {
  return path.points.some((p) => p.handles !== null);
}
