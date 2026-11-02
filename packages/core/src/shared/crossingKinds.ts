import type { CrossingKind } from './types';

/** A plateau top hides from below once the drop reaches this many cells. */
export const DEFAULT_SIGHT_DROP_CELLS = 2;

/** The crossing kinds every map starts with; the DM renames, notes and adds to them. */
export function defaultCrossingKinds(): CrossingKind[] {
  return [
    { id: 'free', name: 'Free', blocks: false },
    { id: 'difficult', name: 'Difficult', blocks: false },
    { id: 'climb', name: 'Climb', note: 'e.g. DC 12 Athletics', blocks: false },
    { id: 'impassable', name: 'Impassable', blocks: true },
  ];
}
