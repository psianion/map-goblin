// The mark tools' geometry, in map cells (one world unit is one cell, cells sit on whole
// numbers). Pure, so snapping, counting and thinning are tested without a renderer.

import type { MarkMsg, Pt, TemplateShape } from './marks';

export type TemplateMsg = Extract<MarkMsg, { kind: 'template' }>;

/** Most points one drawing may carry: the server refuses a stroke past it. */
export const STROKE_MAX = 500;

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** The centre of the cell a point is in: where a ruler's ends snap. */
export const cellCentre = (p: Pt): Pt => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });

/** True for a cell centre, which is how every seat tells a snapped ruler from a free one. */
export const isCellCentre = (p: Pt): boolean => p.x - Math.floor(p.x) === 0.5 && p.y - Math.floor(p.y) === 0.5;

/** The nearer of the closest cell corner and the cell's centre: where a template's origin snaps. */
export function cornerOrCentre(p: Pt): Pt {
  const corner = { x: Math.round(p.x), y: Math.round(p.y) };
  const centre = cellCentre(p);
  return dist(p, corner) <= dist(p, centre) ? corner : centre;
}

/**
 * A ruler's length in cells. Between two cell centres it counts cells the way the table moves,
 * a diagonal step as one cell; a free ruler (Alt) is the straight line.
 */
export function rulerCells(from: Pt, to: Pt): number {
  if (isCellCentre(from) && isCellCentre(to)) return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return dist(from, to);
}

/** The template a drag from `origin` to the pointer makes: whole cells, aimed at the pointer. */
export function templateFromDrag(shape: TemplateShape, origin: Pt, at: Pt): TemplateMsg {
  const dx = at.x - origin.x;
  const dy = at.y - origin.y;
  const reach = shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy);
  const size = Math.max(1, Math.round(reach));
  return shape === 'circle'
    ? { kind: 'template', shape, origin, size }
    : { kind: 'template', shape, origin, size, toward: { x: round2(at.x), y: round2(at.y) } };
}

/** The unit vector a cone or line points along; due east until the pointer has moved. */
function aim(t: TemplateMsg): Pt {
  const dx = (t.toward?.x ?? t.origin.x + 1) - t.origin.x;
  const dy = (t.toward?.y ?? t.origin.y) - t.origin.y;
  const len = Math.hypot(dx, dy);
  return len > 1e-6 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
}

/**
 * The outline of a cone, line or square as a polygon (a circle has none). A cone is as wide
 * as it is long at its end; a line is one cell wide; a square has a corner on the origin and
 * opens toward the pointer.
 */
export function templateOutline(t: TemplateMsg): Pt[] | null {
  const { origin: o, size: s } = t;
  if (t.shape === 'circle') return null;
  if (t.shape === 'square') {
    const sx = (t.toward?.x ?? o.x + 1) < o.x ? -s : s;
    const sy = (t.toward?.y ?? o.y + 1) < o.y ? -s : s;
    return [o, { x: o.x + sx, y: o.y }, { x: o.x + sx, y: o.y + sy }, { x: o.x, y: o.y + sy }];
  }
  const u = aim(t);
  const n = { x: -u.y, y: u.x };
  const end = { x: o.x + u.x * s, y: o.y + u.y * s };
  if (t.shape === 'cone') {
    const half = s / 2;
    return [o, { x: end.x + n.x * half, y: end.y + n.y * half }, { x: end.x - n.x * half, y: end.y - n.y * half }];
  }
  const w = 0.5;
  return [
    { x: o.x + n.x * w, y: o.y + n.y * w },
    { x: end.x + n.x * w, y: end.y + n.y * w },
    { x: end.x - n.x * w, y: end.y - n.y * w },
    { x: o.x - n.x * w, y: o.y - n.y * w },
  ];
}

/** Where a template's label pill sits: inside the shape, toward its middle. */
export function templateLabelAt(t: TemplateMsg): Pt {
  const outline = templateOutline(t);
  if (!outline) return t.origin;
  const u = aim(t);
  if (t.shape === 'cone') return { x: t.origin.x + u.x * t.size * 0.66, y: t.origin.y + u.y * t.size * 0.66 };
  const c = outline.reduce((a, p) => ({ x: a.x + p.x / outline.length, y: a.y + p.y / outline.length }), { x: 0, y: 0 });
  return c;
}

const SHAPE_WORD: Record<TemplateShape, string> = { circle: 'radius', cone: 'cone', line: 'line', square: 'square' };
export const shapeWord = (shape: TemplateShape): string => SHAPE_WORD[shape];

function inPolygon(poly: readonly Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** True when a world point is on the template: what a DM's click on it clears. */
export function templateHit(t: TemplateMsg, p: Pt): boolean {
  if (dist(p, t.origin) <= 0.5) return true;
  const outline = templateOutline(t);
  return outline ? inPolygon(outline, p) : dist(p, t.origin) <= t.size;
}

/**
 * A stroke being drawn takes a point only once the pointer has moved `gap` world units from
 * the last one. When it reaches STROKE_MAX it drops every other point and doubles the gap, so
 * a long scribble keeps its whole shape at a coarser grain and never passes the cap.
 */
export function addStrokePoint(stroke: { points: [number, number][]; gap: number }, p: Pt): boolean {
  const last = stroke.points[stroke.points.length - 1];
  if (last && Math.hypot(p.x - last[0], p.y - last[1]) < stroke.gap) return false;
  stroke.points.push([round2(p.x), round2(p.y)]);
  if (stroke.points.length >= STROKE_MAX) {
    const end = stroke.points[stroke.points.length - 1]!;
    stroke.points = stroke.points.filter((_, i) => i % 2 === 0);
    if (stroke.points[stroke.points.length - 1] !== end) stroke.points.push(end);
    stroke.gap *= 2;
  }
  return true;
}

/** An SVG path through a stroke's points, curved through their midpoints so it reads smooth. */
export function smoothPath(points: readonly [number, number][]): string {
  if (points.length === 0) return '';
  const [first] = points;
  if (points.length < 3) return `M${first![0]} ${first![1]}` + points.slice(1).map(([x, y]) => ` L${x} ${y}`).join('');
  let d = `M${first![0]} ${first![1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const [lx, ly] = points[points.length - 1]!;
  return `${d} L${lx} ${ly}`;
}
