// Pure pieces of the Elevation tool and the plateau card: the edge choices, the height step
// that never lands on flat, what Blocks sight writes, a slope's Face and Direction, and the Top.

import type { PlateauChild } from '@/store/types';
import type { EdgeKind } from '@dnd/core/src/shared/plateaus';
import { cliffChoice, DEFAULT_CLIFF_FAMILY, DEFAULT_CLIFF_SET, isPaintedBorder, PAINTED_BORDER } from '@dnd/core/src/engine/plateauKit';
import { FACE_DIRECTION_STEP, wrapDirection } from '@dnd/core/src/shared/plateauShade';

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

/** The Face row's value for no face texture: the ledge shading over whatever ground is there. */
export const GROUND_FACE = 'ground';

/** What the Face row shows for a stored `faceArt`: Ground when there is none. */
export const faceArtValue = (faceArt: string | undefined): string => faceArt ?? GROUND_FACE;

/** The `faceArt` the Face row writes for `choice`: nothing for Ground. */
export const faceArtFor = (choice: string): string | undefined => (choice === GROUND_FACE ? undefined : choice);

/** The Top row's value for no top texture: the top shows what is under it. */
export const GROUND_TOP = 'ground';

/** What the Top row shows for a stored `topArt`: Ground when there is none. */
export const topArtValue = (topArt: string | undefined): string => topArt ?? GROUND_TOP;

/** The `topArt` the Top row writes for `choice`: nothing for Ground. */
export const topArtFor = (choice: string): string | undefined => (choice === GROUND_TOP ? undefined : choice);

/** A face direction snapped to the dial's step, kept to 0..345. */
export function snapDirection(deg: number): number {
  return wrapDirection(Math.round(deg / FACE_DIRECTION_STEP) * FACE_DIRECTION_STEP);
}

/** The face direction a point `(dx, dy)` from the dial's centre points at, snapped (screen y down, 0 right, 90 down). */
export function directionAt(dx: number, dy: number): number {
  return snapDirection((Math.atan2(dy, dx) * 180) / Math.PI);
}

const DIRECTION_WORDS = ['right', 'lower right', 'down', 'lower left', 'left', 'upper left', 'up', 'upper right'];

/** A face direction in words, by its nearest eighth: 60 is lower right. */
export function directionWords(deg: number): string {
  return DIRECTION_WORDS[Math.round(wrapDirection(deg) / 45) % 8];
}

/** The cave rock of the default set is stored as nothing, however an older plateau names it. */
export const DEFAULT_ART = 'default';

/** What the Cliff art row shows for a stored `edgeArt`: Cave rock as DEFAULT_ART, any painted border as PAINTED_BORDER. */
export function cliffArtValue(edgeArt: string | undefined): string {
  if (isPaintedBorder(edgeArt)) return PAINTED_BORDER;
  const { setId, family } = cliffChoice(edgeArt);
  return setId === DEFAULT_CLIFF_SET && family === DEFAULT_CLIFF_FAMILY ? DEFAULT_ART : (edgeArt ?? DEFAULT_ART);
}

/** The `edgeArt` the Cliff art row writes for `choice`; a painted border picked again keeps its texture. */
export function edgeArtFor(choice: string, current: string | undefined): string | undefined {
  if (choice === DEFAULT_ART) return undefined;
  if (choice === PAINTED_BORDER && isPaintedBorder(current)) return current;
  return choice;
}

/** Border width steps, cells. */
export const BORDER_STEP = 0.25;

/** The value that means the edge kind's own crossing: nothing stored. */
export const EDGE_CROSSING = 'edge';
