// Pure pieces of the Elevation tool and the plateau card: the edge choices, the height step
// that never lands on flat, and what Blocks sight writes.

import type { PlateauChild } from '@/store/types';
import type { EdgeKind } from '@dnd/core/src/shared/plateaus';

export const EDGE_OPTIONS: { value: EdgeKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'slope', label: 'Slope' },
  { value: 'cliff', label: 'Cliff' },
];

/** A plateau is never flat: a step that lands on 0 goes on to the other side. */
export function stepHeight(height: number, d: number): number {
  return height + d === 0 ? height + 2 * d : height + d;
}

export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/**
 * Blocks sight as one switch over the stored override. Auto is the default: while the
 * switch agrees with what the map's sight drop decides (`auto`), nothing is stored; flipping
 * it away pins the other answer, and flipping it back drops the pin.
 */
export function sightOverrideFor(blocks: boolean, auto: boolean): PlateauChild['sightOverride'] {
  if (blocks === auto) return undefined;
  return blocks ? 'hide' : 'show';
}

/** Whether a plateau blocks sight, given what Auto would say for it. */
export function blocksSight(p: Pick<PlateauChild, 'sightOverride'>, auto: boolean): boolean {
  return p.sightOverride === undefined ? auto : p.sightOverride === 'hide';
}

export const SLOPE_STEP = 0.5;

/** The cave rock of the default set is stored as nothing, however an older plateau names it. */
export const DEFAULT_ART = 'default';

/** The value that means the edge kind's own crossing: nothing stored. */
export const EDGE_CROSSING = 'edge';
