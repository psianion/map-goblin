// Where a floor outline's measured cave rock meets a cut-stone wall: the kit's transition piece,
// rock at one end and stone at the other, laid across the vertex where the two runs meet. The
// rock stops at the piece's rock joint and the stone at its wall joint, so nothing is drawn under
// it. Pure geometry: the wall renderer (renderRingEdges) finds the vertices and lays the runs.

import { kitTransitions, placeOnChord, type CaveKitPiece } from '../assets/caveWallKit';
import { BAND_OUT, kitOverlap, type WalkPlacement } from './caveWalk';

type Vec = [number, number];

/** How far off in line, or off a right angle, two runs may meet and still take a transition, degrees. */
export const TRANSITION_TURN_TOL = 10;
/** What each run keeps past a straight piece for the long one to be laid rather than the short, cells. */
export const TRANSITION_LONG_KEEP = 2;
/** The least each run keeps past any transition, cells: shorter, the two meet as they always did. */
const LEAST_KEEP = 0.25;
/**
 * How far from the vertex the art's own floor point may land, as a share of the drawn size. The
 * other hand lands it on the far side of its joints' chord, a corner turning the other way
 * farther still.
 */
const HAND_REACH = 0.2;

/** A transition laid at a vertex. */
export interface Transition {
  pl: WalkPlacement;
  /** How far the rock's run stops short of the vertex, cells along it: lapping the piece's rock joint as its own pieces lap. */
  cave: number;
  /** How far the stone wall's run stops short of the vertex, cells along it. */
  wall: number;
}

/** A gap on the outline: a door, an Opening or a carved mouth. */
interface Gap {
  position: [number, number];
  width: number;
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const neg = (a: Vec): Vec => [-a[0], -a[1]];

/** How far along its arm from the art's floor point a joint lies, cells: its farther coordinate. */
const reachOf = (j: readonly number[]): number => Math.max(Math.abs(j[0]), Math.abs(j[1]));

/**
 * The transition laid at `V`, where a run of the measured kit `set`'s rock meets a run of the
 * wall set `wallSet`, walking the outline with the floor on the right: `uIn` the direction into
 * `V`, `uOut` out of it, both of unit length, and `caveIn` whether the rock is the run coming in.
 * `sideCave` and `sideWall` are the lengths of the two sides that meet at `V`; `size` the rock's
 * drawn size. Null where the kit has no transition for the wall set, the runs meet at any angle
 * but in line or a right angle turning the way the corner art turns, either side is too short to
 * hold the piece, or a gap lies within the piece's length of `V`: the two meet as they always did.
 */
export function transitionAt(
  set: readonly CaveKitPiece[],
  wallSet: string,
  V: Vec,
  uIn: Vec,
  uOut: Vec,
  caveIn: boolean,
  sideCave: number,
  sideWall: number,
  size: number,
  gaps: readonly Gap[] = [],
): Transition | null {
  const turn = (Math.atan2(uIn[0] * uOut[1] - uIn[1] * uOut[0], uIn[0] * uOut[0] + uIn[1] * uOut[1]) * 180) / Math.PI;
  const kind = Math.abs(turn) <= TRANSITION_TURN_TOL ? 'straight' : Math.abs(Math.abs(turn) - 90) <= TRANSITION_TURN_TOL ? 'corner' : null;
  if (!kind) return null;
  const fits = kitTransitions(set).filter((p) => p.transition === kind && p.walls?.includes(wallSet));
  if (fits.length === 0) return null;
  const extents = (p: CaveKitPiece): { cave: number; wall: number } => {
    const w = p.wallJoint ?? 0;
    return { cave: reachOf(p.jointsCells[1 - w]) * size, wall: reachOf(p.jointsCells[w]) * size };
  };
  // Longest first. Any but the shortest is laid only where each run keeps TRANSITION_LONG_KEEP past it.
  const lengths = [...new Set(fits.map((p) => Math.round(p.chordCells * 100)))].sort((a, b) => b - a);
  const keeps = (p: CaveKitPiece, least: number): boolean => {
    const e = extents(p);
    return sideCave - e.cave >= least && sideWall - e.wall >= least;
  };
  const length = lengths.find((L, k) => fits.some((p) => Math.round(p.chordCells * 100) === L && keeps(p, k + 1 < lengths.length ? TRANSITION_LONG_KEEP : LEAST_KEEP)));
  if (length === undefined) return null;
  const hands = fits.filter((p) => Math.round(p.chordCells * 100) === length);
  if (gaps.some((g) => Math.hypot(g.position[0] - V[0], g.position[1] - V[1]) - g.width / 2 < hands[0].chordCells * size)) return null;
  const caveDir = caveIn ? neg(uIn) : uOut;
  const wallDir = caveIn ? uOut : neg(uIn);
  // The void lies left of travel; the rock's joints sit twice the band's shove out into it.
  const uCave = caveIn ? uIn : uOut;
  const voidSide: Vec = [uCave[1], -uCave[0]];
  let best: { t: Transition; miss: number } | null = null;
  for (const piece of hands) {
    const e = extents(piece);
    const jc = add(add(V, mul(caveDir, e.cave)), mul(voidSide, 2 * BAND_OUT * size));
    const jw = add(V, mul(wallDir, e.wall));
    const [P, Q] = (piece.wallJoint ?? 0) === 0 ? [jw, jc] : [jc, jw];
    const at = placeOnChord(piece, P, Q);
    const miss = Math.hypot(at.position.x - V[0], at.position.y - V[1]);
    if (miss > HAND_REACH * size || (best && best.miss <= miss)) continue;
    // The rock's run laps the piece at its rock joint as two of its own pieces lap: it stops half a
    // lap short of the joint, its last piece's joint running half a lap past its end.
    const lap = (kitOverlap(set) / 2) * size;
    best = { t: { pl: { piece, P, Q, i: 0, nudge: 0, branch: 'transition', at }, cave: e.cave - lap, wall: e.wall }, miss };
  }
  return best?.t ?? null;
}

/** The open polyline `pts` with `head` cells cut off its start and `tail` off its end, along it. */
export function cutRun(pts: readonly [number, number][], head: number, tail: number): [number, number][] {
  let out = pts.map((p): [number, number] => [p[0], p[1]]);
  const cut = (line: [number, number][], d: number): [number, number][] => {
    let left = d;
    for (let i = 0; i + 1 < line.length; i++) {
      const s = sub(line[i + 1], line[i]);
      const L = Math.hypot(s[0], s[1]);
      if (left < L) return [add(line[i], mul(s, left / L)), ...line.slice(i + 1)];
      left -= L;
    }
    return [line[line.length - 1]];
  };
  if (head > 0) out = cut(out, head);
  if (tail > 0) out = cut([...out].reverse(), tail).reverse();
  return out;
}
