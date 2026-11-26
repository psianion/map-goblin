// Where walls of an outlined (continuous) set meet: a T, where one drawn wall ends on
// another wall's side, and a cross, where two drawn walls pass through each other.
//
// Pure geometry, no Pixi: the renderer lays a joint piece on top of both walls at each
// joint found here, and drops the ending wall's end cap at a T. Neither wall is cut.

/** One wall's spine, as the joint search needs it. */
export interface JointSpine {
  points: readonly (readonly [number, number])[];
  /** The wall set the spine resolves to. Joints only form between spines of one set. */
  setId: string;
  /** Wall width, cells. Joints only form between spines of one width. */
  width: number;
  /** A loop: no ends, so it never ends on another wall. */
  closed: boolean;
  /** A floor ring's outline rather than a drawn wall: a T may end on it, it never crosses. */
  ring?: boolean;
}

/** A door opening, as the joint search needs it. */
export interface JointGap {
  position: readonly [number, number];
  width: number;
}

export interface WallJoint {
  kind: 'tee' | 'cross';
  x: number;
  y: number;
  /**
   * Rotation of the joint piece. A tee is authored with its bar along x and its stem
   * toward +y, so this turns the stem along the ending wall; a cross lies along `spine`.
   */
  angle: number;
  /** The ending wall of a tee, or the first wall of a cross (index into the input). */
  spine: number;
  /** The wall the tee ends on, or the second wall of a cross. */
  other: number;
  /** Which end of `spine` a tee is at: 0 its first point, 1 its last. */
  end?: 0 | 1;
}

/** How far from a right angle two walls may meet and still take a joint piece. */
const SQUARE_TOL = 15 * (Math.PI / 180);
const SQUARE_SIN = Math.sin(SQUARE_TOL);

interface Seg {
  ax: number;
  ay: number;
  /** Unit direction. */
  ux: number;
  uy: number;
  len: number;
  /** Arc length along the spine at `a`. */
  s: number;
}

function segmentsOf(spine: JointSpine): { segs: Seg[]; total: number } {
  const pts = spine.points;
  const n = pts.length;
  const count = spine.closed ? n : n - 1;
  const segs: Seg[] = [];
  let s = 0;
  for (let i = 0; i < count; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    segs.push({ ax, ay, ux: (bx - ax) / len, uy: (by - ay) / len, len, s });
    s += len;
  }
  return { segs, total: s };
}

/** True when arc position `s` is clear of an open spine's ends by `clear`. */
function awayFromEnds(spine: JointSpine, s: number, total: number, clear: number): boolean {
  return spine.closed || (s >= clear && s <= total - clear);
}

function inGap(x: number, y: number, gaps: readonly JointGap[]): boolean {
  return gaps.some((g) => Math.hypot(x - g.position[0], y - g.position[1]) < g.width / 2);
}

const alike = (a: JointSpine, b: JointSpine): boolean => a.setId === b.setId && Math.abs(a.width - b.width) < 1e-9;

/**
 * The joint pieces a layer's walls take. A tee where an open drawn wall's end lies within
 * half the wall width of another spine, away from that spine's ends; a cross where two
 * drawn walls cross away from both their ends. Both only near a right angle, between
 * spines of one set and width, and never inside a door opening.
 */
export function findWallJoints(spines: readonly JointSpine[], gaps: readonly JointGap[] = []): WallJoint[] {
  const shapes = spines.map(segmentsOf);
  const out: WallJoint[] = [];

  // ── Tees ──
  spines.forEach((spine, w) => {
    if (spine.ring || spine.closed || shapes[w].segs.length === 0) return;
    const pts = spine.points;
    for (const end of [0, 1] as const) {
      const [px, py] = end === 0 ? pts[0] : pts[pts.length - 1];
      // Outward at the end: from the wall's body toward its tip.
      const seg = end === 0 ? shapes[w].segs[0] : shapes[w].segs[shapes[w].segs.length - 1];
      const dx = end === 0 ? -seg.ux : seg.ux;
      const dy = end === 0 ? -seg.uy : seg.uy;
      let best: WallJoint | null = null;
      let bestDist = Infinity;
      for (let o = 0; o < spines.length; o++) {
        const other = spines[o];
        if (o === w || !alike(spine, other)) continue;
        const { segs, total } = shapes[o];
        for (const g of segs) {
          const u = Math.min(Math.max((px - g.ax) * g.ux + (py - g.ay) * g.uy, 0), g.len);
          const dist = Math.hypot(px - (g.ax + g.ux * u), py - (g.ay + g.uy * u));
          if (dist > spine.width / 2 || dist >= bestDist) continue;
          if (Math.abs(dx * g.ux + dy * g.uy) > SQUARE_SIN) continue;
          if (!awayFromEnds(other, g.s + u, total, spine.width)) continue;
          // Where the ending wall's line meets the other spine.
          const denom = dx * g.uy - dy * g.ux;
          const t = ((g.ax - px) * g.uy - (g.ay - py) * g.ux) / denom;
          const x = px + dx * t;
          const y = py + dy * t;
          if (inGap(x, y, gaps)) continue;
          bestDist = dist;
          // The stem (+y as authored) points back along the ending wall.
          best = { kind: 'tee', x, y, angle: Math.atan2(-dy, -dx) - Math.PI / 2, spine: w, other: o, end };
        }
      }
      if (best) out.push(best);
    }
  });

  // ── Crosses ──
  for (let i = 0; i < spines.length; i++) {
    if (spines[i].ring) continue;
    for (let j = i + 1; j < spines.length; j++) {
      if (spines[j].ring || !alike(spines[i], spines[j])) continue;
      const clear = spines[i].width;
      for (const a of shapes[i].segs) {
        for (const b of shapes[j].segs) {
          const denom = a.ux * b.uy - a.uy * b.ux;
          if (Math.abs(denom) < 1e-9) continue;
          if (Math.abs(a.ux * b.ux + a.uy * b.uy) > SQUARE_SIN) continue;
          const qx = b.ax - a.ax;
          const qy = b.ay - a.ay;
          const ta = (qx * b.uy - qy * b.ux) / denom;
          const tb = (qx * a.uy - qy * a.ux) / denom;
          // Half-open, so a crossing on a shared vertex counts once.
          if (ta < 0 || ta >= a.len || tb < 0 || tb >= b.len) continue;
          if (!awayFromEnds(spines[i], a.s + ta, shapes[i].total, clear)) continue;
          if (!awayFromEnds(spines[j], b.s + tb, shapes[j].total, clear)) continue;
          const x = a.ax + a.ux * ta;
          const y = a.ay + a.uy * ta;
          if (inGap(x, y, gaps)) continue;
          out.push({ kind: 'cross', x, y, angle: Math.atan2(a.uy, a.ux), spine: i, other: j });
        }
      }
    }
  }
  return out;
}
