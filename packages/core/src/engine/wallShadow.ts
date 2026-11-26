// The shadow a measured kit's wall lays on the floor, drawn by the app as one soft band along
// the rock's line rather than piece by piece. Each piece's own shadow parted where two pieces
// met at an angle, and lit floor showed through the notch; one band along the line the rock
// was laid on (its seat, as saved in `rockLines`) has no joints to part at.
//
// The band lies on the floor side of the line only (the right of the walk's travel), full from
// the line out to the rock's floor-side face, half the kit's rock width on, then easing out to
// nothing over the kit's shadow reach. Where the rock stops (a door, a mouth, an open run's
// end) the band stops square with it, and none of it lies on an erased opening. A kit whose
// art carries its own shadow gets no band: its pieces are bent to meet at their joints
// (bandBend.ts), so that shadow no longer parts. A ramp (rampMask.ts), never steps.

import type { Polygon } from '../types/geometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { kitRockWidth, kitShadow } from '../assets/caveWallKit';
import { seatLine } from './caveBandRenderer';
import type { WalkPlacement } from './caveWalk';
import { ledgeRuns } from './plateauRenderer';
import { distanceToLines, fallOff, keptRamp, rampGrid, type Ramp, type RampLine } from './rampMask';

/** What one ring or run of a wall laid: its pieces, whether it closes, and the size it was laid at. */
export interface LaidRock {
  placed: WalkPlacement[];
  closed: boolean;
  size: number;
}

/** Texels per cell a wall's shadow is worked out at, at most: a smooth ramp, so it filters up cleanly. */
const SHADOW_TEXELS_PER_CELL = 10;
/** The shadow's longest side, texels: a wider map's is worked out coarser. */
const SHADOW_MAX_DIM = 2048;

/** One line of rock the shadow is laid along, and how. */
interface ShadowLine extends RampLine {
  /** Where the rock's floor-side face lies from the line, cells. */
  face: number;
  reach: number;
  strength: number;
}

/** The lines `laid` was laid on, each with its kit's shadow; none for a kit with no measured pieces. */
function shadowLines(laid: LaidRock): ShadowLine[] {
  const set = laid.placed.map((pl) => pl.piece);
  const shadow = kitShadow(set);
  // A kit whose art carries its own shadow casts it from its bent art (bandBend.ts).
  if (!shadow || shadow.baked) return [];
  // A ring laid smaller for its narrow passages, or a hole ringed smaller, casts that much less.
  const size = laid.placed[0]?.size ?? laid.size;
  const face = (kitRockWidth(set) / 2) * size;
  const reach = shadow.reach * size;
  const strength = shadow.strength;
  return ledgeRuns(laid.placed, laid.closed)
    .map(({ run, open }) => ({ pts: seatLine(run, !open), closed: !open, face, reach, strength }))
    .filter((l) => l.pts.length >= 2);
}

/**
 * The floor shadow of every wall of a measured kit in `laid` (floor rings, painted caves, drawn
 * walls) as one ramp, its field the shadow's opacity, drawn in black, kept off the layer's
 * erased `openings`. Null when none of them is laid with a measured kit: such a map paints
 * nothing new.
 */
export function wallShadowRamp(laid: readonly LaidRock[], openings: readonly Polygon[] = []): Ramp | null {
  const lines = laid.flatMap(shadowLines);
  if (lines.length === 0) return null;
  return keptRamp('wall-shadow', [lines, openings], () => {
    const reach = Math.max(...lines.map((l) => l.face + l.reach));
    const grid = rampGrid(
      lines.map((l) => l.pts),
      reach + 0.1,
      SHADOW_TEXELS_PER_CELL,
      SHADOW_MAX_DIM,
    );
    if (!grid) return null;
    const { d, owner, right } = distanceToLines(lines, grid, reach, true);
    const { x, y, res, width, height } = grid;
    const box: Polygon = [
      [x, y],
      [x + width / res, y],
      [x + width / res, y + height / res],
      [x, y + height / res],
    ];
    // Only the texels near some rock are worked out: the rest of a map is no shadow.
    const alpha = new Float32Array(width * height);
    for (let k = 0; k < alpha.length; k++) {
      if (owner[k] < 0 || !right[k]) continue;
      const l = lines[owner[k]];
      alpha[k] = l.strength * fallOff(d[k], l.face, l.reach);
    }
    return {
      field: { grid, alpha },
      clip: openings.length > 0 ? clipper2Engine.difference([box], [...openings]) : null,
    };
  });
}
