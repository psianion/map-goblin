// Handles for editing a floor outline's vertices.
//
// Same shape as wallNodeOverlay: a world-space Graphics wired in from
// sceneGraph, redrawn from the render loop, signature-guarded so it only
// rebuilds when something it draws changed.

import type { Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import type { Point, Polygon } from '../types/geometry';
import { resolveOutline } from './shapeNodeEdit';

const OUTLINE_COLOR = 0x6c63ff;
const HANDLE_COLOR = 0x38bdf8;
const SELECTED_COLOR = 0xfbbf24;
const INSERT_COLOR = 0x94a3b8;

/**
 * Sizes in SCREEN pixels, converted per draw. World-sized handles shrink with
 * the map and become uncatchable when zoomed out — the same trap the wall node
 * handles fell into.
 */
const HANDLE_RADIUS_PX = 5;
const INSERT_RADIUS_PX = 3.2;
const PICK_RADIUS_PX = 11;
/** An edge must be at least this long on screen to be worth an insert marker. */
const MIN_EDGE_FOR_INSERT_PX = 26;

let overlay: Graphics | null = null;
let lastSignature = '';

export function initShapeNodeOverlay(graphics: Graphics): void {
  overlay = graphics;
  overlay.label = 'shapeNodeOverlay';
  lastSignature = '';
}

/** The outline currently exposed for editing, or null. */
export function currentOutline(): Polygon | null {
  const id = useStore.getState().tools.shapeNodeEditId;
  if (!id) return null;
  return resolveOutline(id)?.outline ?? null;
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function renderShapeNodeHandles(zoom: number): void {
  if (!overlay) return;
  const state = useStore.getState();
  const outline = currentOutline();

  const signature = outline
    ? [
        state.tools.shapeNodeEditId,
        state.tools.selectedVertex ?? '',
        zoom.toFixed(3),
        outline.length,
        // Coordinates, or dragging a vertex would not redraw its handle.
        outline.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';'),
      ].join('|')
    : '';
  if (signature === lastSignature) return;
  lastSignature = signature;

  overlay.clear();
  if (!outline || outline.length < 3) return;

  const safeZoom = zoom > 0 ? zoom : 1;
  const r = HANDLE_RADIUS_PX / safeZoom;
  const ri = INSERT_RADIUS_PX / safeZoom;
  const minEdge = MIN_EDGE_FOR_INSERT_PX / safeZoom;
  const selected = state.tools.selectedVertex;

  // The outline itself, so the run reads as one object while being picked apart.
  overlay.poly(outline.flat(), true);
  overlay.stroke({ color: OUTLINE_COLOR, width: r * 0.3, alpha: 0.9 });

  // Insert markers first, so a vertex handle always wins the visual overlap.
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minEdge) continue;
    const [mx, my] = midpoint(a, b);
    overlay.circle(mx, my, ri);
    overlay.fill({ color: INSERT_COLOR, alpha: 0.7 });
  }

  for (let i = 0; i < outline.length; i++) {
    const isSel = selected === i;
    overlay.circle(outline[i][0], outline[i][1], isSel ? r * 1.35 : r);
    overlay.fill({ color: isSel ? SELECTED_COLOR : HANDLE_COLOR, alpha: isSel ? 0.95 : 0.7 });
    overlay.stroke({ color: 0x0b1220, width: r * 0.18, alpha: 0.85 });
  }
}

export type OutlineHit =
  | { kind: 'vertex'; index: number }
  | { kind: 'insert'; index: number; x: number; y: number }
  | { kind: 'edge'; index: number };

/** Distance from `p` to segment ab, and where along it the foot lands. */
function distToSegment(p: Point, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a[0], p.y - a[1]);
  let t = ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
}

/**
 * What the pointer is over, in priority order: a vertex, then an insert marker,
 * then the edge itself. Vertices win so a corner is never mistaken for the run
 * leading into it.
 */
export function outlineHitAt(world: Point, zoom: number): OutlineHit | null {
  const outline = currentOutline();
  if (!outline || outline.length < 3) return null;
  const pick = PICK_RADIUS_PX / (zoom > 0 ? zoom : 1);
  const minEdge = MIN_EDGE_FOR_INSERT_PX / (zoom > 0 ? zoom : 1);

  let best: { index: number; d: number } | null = null;
  for (let i = 0; i < outline.length; i++) {
    const d = Math.hypot(world.x - outline[i][0], world.y - outline[i][1]);
    if (d < pick && (!best || d < best.d)) best = { index: i, d };
  }
  if (best) return { kind: 'vertex', index: best.index };

  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minEdge) continue;
    const [mx, my] = midpoint(a, b);
    if (Math.hypot(world.x - mx, world.y - my) < pick) {
      return { kind: 'insert', index: i, x: mx, y: my };
    }
  }

  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (distToSegment(world, a, b) < pick) return { kind: 'edge', index: i };
  }
  return null;
}
