// Waterfalls: where a liquid path leaves a drop, a fall hangs over the edge. Which stretches
// of edge a path's water leaves by is the plateau code's to say (it knows the rings and their
// heights, and installs itself with `setCliffCrossings`); this turns each stretch into the box
// its fall fills, and draws the fall in code until the ink kit ships one.

import type { Graphics } from 'pixi.js';
import type { DungeonLayer } from '../../store/types';
import type { PathChild } from '../../shared/types';

type Vec = [number, number];

/**
 * A stretch of raised edge a path's water leaves by: from `a` to `b` along the edge (a
 * river's is as wide as the river where it crosses; a lake's is the run of shore along the
 * cliff), `downhill` the unit direction it falls, `drop` the cells fallen.
 */
export interface CliffCrossing {
  a: Vec;
  b: Vec;
  downhill: Vec;
  drop: number;
}

/** One fall: the centre of its box, the direction it falls (radians), and its size in cells. */
export interface FallPlacement {
  x: number;
  y: number;
  /** Direction of the fall, radians: the box's lip faces the other way. */
  angle: number;
  /** Across the fall: the stretch's length along the edge. */
  width: number;
  /** Down the fall. */
  length: number;
}

/** The longest a fall hangs, cells, however far the water drops. */
export const MAX_FALL = 3;

/**
 * The box each crossing's fall fills: hung from the edge stretch, as wide as the stretch is
 * long, down the drop for min(drop, MAX_FALL) cells. A crossing that drops nothing has none.
 */
export function waterfallSpans(crossings: readonly CliffCrossing[]): FallPlacement[] {
  const out: FallPlacement[] = [];
  for (const c of crossings) {
    const width = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
    if (c.drop <= 0 || width < 1e-6) continue;
    const length = Math.min(c.drop, MAX_FALL);
    const mx = (c.a[0] + c.b[0]) / 2;
    const my = (c.a[1] + c.b[1]) / 2;
    out.push({
      x: mx + (c.downhill[0] * length) / 2,
      y: my + (c.downhill[1] * length) / 2,
      angle: Math.atan2(c.downhill[1], c.downhill[0]),
      width,
      length,
    });
  }
  return out;
}

type CrossingsFn = (layer: Pick<DungeonLayer, 'children'>, path: PathChild) => readonly CliffCrossing[];

/**
 * Where a path's cliff crossings come from: the plateau code installs its own with
 * `setCliffCrossings` (plateauRenderer.ts); until then a path crosses none.
 */
let crossingsOf: CrossingsFn = () => [];

export function setCliffCrossings(fn: CrossingsFn | null): void {
  crossingsOf = fn ?? (() => []);
}

export function cliffCrossingsOf(layer: Pick<DungeonLayer, 'children'>, path: PathChild): readonly CliffCrossing[] {
  return crossingsOf(layer, path);
}

const INK = 0x2b2420;
/** The pale band of foam at a fall's foot, cells deep. */
const FOAM = 0.12;

/** `colour` taken `k` of the way to white. */
function lighten(colour: number, k: number): number {
  const ch = (shift: number) => {
    const c = (colour >> shift) & 255;
    return Math.round(c + (255 - c) * k);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * One fall drawn into `g`, in the box's own frame (x across, y down the fall) turned onto the
 * fall: the strip in the water's `colour` at 70 %, four to six lighter streaks down it, an ink
 * line down each side, and a thin band of pale foam at its foot.
 */
export function drawFall(g: Graphics, f: FallPlacement, colour: number): void {
  const w = f.width / 2;
  const l = f.length / 2;
  g.position.set(f.x, f.y);
  g.rotation = f.angle - Math.PI / 2;
  g.rect(-w, -l, f.width, f.length).fill({ color: colour, alpha: 0.7 });
  const streaks = Math.max(4, Math.min(6, Math.round(f.width / 0.3)));
  for (let k = 0; k < streaks; k++) {
    const x = -w + (f.width * (k + 0.5)) / streaks;
    g.moveTo(x, -l).lineTo(x, l - FOAM);
  }
  g.stroke({ color: lighten(colour, 0.5), width: 0.035, alpha: 0.55 });
  g.rect(-w, l - FOAM, f.width, FOAM).fill({ color: 0xf2f8fa, alpha: 0.75 });
  g.moveTo(-w, -l).lineTo(-w, l).moveTo(w, -l).lineTo(w, l).stroke({ color: INK, width: 0.04, alpha: 0.8 });
}
