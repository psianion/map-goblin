// Waterfalls: where a liquid path meets a drop, its material's `fall` sprite hangs over
// the edge. Which spans of a path cross a cliff is the plateau code's to say (it knows the
// rings and their heights); this turns those spans into sprite placements and draws them.

import { Container, Sprite, type Texture } from 'pixi.js';
import type { PathChild } from '../../shared/types';
import { pathCentreline } from '../../geometry/pathGeometry';
import type { Centreline } from '../../geometry/ribbon';

/**
 * A stretch of a path's centreline that crosses a cliff, by arc length (cells). A river
 * crossing a ring is a point (`start === end`); a lake whose shore runs along a cliff is a
 * span. `down` says which way the drop falls: for a point, +1 = in the path's direction of
 * travel; for a span, +1 = out of the closed path (to its outside). `drop` is the height
 * fallen, cells.
 */
export interface CliffCrossing {
  start: number;
  end: number;
  down: 1 | -1;
  drop: number;
}

/** One fall sprite: its centre, the direction it falls (radians), and its size in cells. */
export interface FallPlacement {
  x: number;
  y: number;
  /** Direction of the fall, radians: the sprite's top (the lip) faces the other way. */
  angle: number;
  /** Across the fall. */
  width: number;
  /** Down the fall. */
  length: number;
}

/** The fall art is 2x2: a lake's span is laid with pieces about this wide. */
const FALL_PIECE = 2;

function sampleAt(line: Centreline, s: number): { x: number; y: number; dx: number; dy: number; width: number } {
  const { xy, arc, width } = line;
  let i = 1;
  while (i < arc.length - 1 && arc[i] < s) i++;
  const a = xy[i - 1];
  const b = xy[i];
  const span = arc[i] - arc[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (s - arc[i - 1]) / span));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    dx: (b[0] - a[0]) / len,
    dy: (b[1] - a[1]) / len,
    width: width[i - 1] + (width[i] - width[i - 1]) * t,
  };
}

/** Signed area of the centreline ring: its sign says which side of travel is inside. */
function signedArea(line: Centreline): number {
  let s = 0;
  for (let i = 0; i < line.xy.length - 1; i++) {
    const [x0, y0] = line.xy[i];
    const [x1, y1] = line.xy[i + 1];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/**
 * Where the fall sprites go for `crossings` of `path`. A point crossing gets one sprite as
 * wide as the path there, hanging past the crossing; a span gets pieces about two cells
 * wide laid along it at the outer edge of the shoreline ribbon, falling outward or inward.
 */
export function waterfallSpans(path: PathChild, crossings: readonly CliffCrossing[]): FallPlacement[] {
  const line = pathCentreline(path);
  if (line.xy.length < 2) return [];
  const out: FallPlacement[] = [];
  // Left of travel ((-dy, dx)) is inside a ring of positive signed area.
  const outward = signedArea(line) > 0 ? -1 : 1;
  for (const c of crossings) {
    const length = Math.max(1, c.drop);
    const start = Math.max(0, Math.min(c.start, c.end));
    const end = Math.min(line.length, Math.max(c.start, c.end));
    if (end - start < 1e-6) {
      const p = sampleAt(line, start);
      const fx = p.dx * c.down;
      const fy = p.dy * c.down;
      out.push({ x: p.x + (fx * length) / 2, y: p.y + (fy * length) / 2, angle: Math.atan2(fy, fx), width: p.width, length });
      continue;
    }
    const pieces = Math.max(1, Math.round((end - start) / FALL_PIECE));
    const piece = (end - start) / pieces;
    for (let k = 0; k < pieces; k++) {
      const p = sampleAt(line, start + piece * (k + 0.5));
      const side = outward * c.down;
      const nx = -p.dy * side;
      const ny = p.dx * side;
      const reach = p.width / 2 + length / 2;
      out.push({ x: p.x + nx * reach, y: p.y + ny * reach, angle: Math.atan2(ny, nx), width: piece, length });
    }
  }
  return out;
}

/**
 * Where a path's cliff crossings come from. Nothing supplies them until plateaus do; the
 * plateau code installs its own with `setCliffCrossings`.
 */
let crossingsOf: (path: PathChild) => readonly CliffCrossing[] = () => [];

export function setCliffCrossings(fn: ((path: PathChild) => readonly CliffCrossing[]) | null): void {
  crossingsOf = fn ?? (() => []);
}

export function cliffCrossingsOf(path: PathChild): readonly CliffCrossing[] {
  return crossingsOf(path);
}

/** Fall sprites for `placements`, the texture's top edge at the lip. */
export function drawFalls(parent: Container, texture: Texture, placements: readonly FallPlacement[]): void {
  for (const f of placements) {
    const s = new Sprite(texture);
    s.anchor.set(0.5);
    s.width = f.width;
    s.height = f.length;
    // The texture runs top to bottom; turn its +y onto the fall's direction.
    s.rotation = f.angle - Math.PI / 2;
    s.position.set(f.x, f.y);
    parent.addChild(s);
  }
}
