// Handles for editing a floor outline's vertices.
//
// Same shape as wallNodeOverlay: a world-space Graphics wired in from
// sceneGraph, redrawn from the render loop, signature-guarded so it only
// rebuilds when something it draws changed.
//
// The outline may be an authored ring with curves (see OutlineTarget.tangents):
// corners draw as squares, smooth anchors as circles, and the selected anchor
// and its neighbours grow tangent arms. Everything geometric — the rope dash,
// the dim hole, edge picking — works on the flattened ring, so what is drawn is
// exactly what the floor will be.

import { Text, TextStyle, type Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import type { Point } from '../types/geometry';
import { resolveOutline, type OutlineTarget } from './shapeNodeEdit';
import { strokeRopeDash, drawNodeHandle, drawInsertPuck, drawEditDim, drawTangentArm } from './overlayDraw';
import { OVERLAY_INK } from './overlayPalette';
import {
  edgeControls,
  edgeIsCurved,
  flattenCubic,
  flattenRing,
  pointOnCubic,
  type RingTangents,
  type Vec2,
  type VertexTangents,
} from '../shared/bezier';

/**
 * Sizes in SCREEN pixels, converted per pick. World-sized handles shrink with
 * the map and become uncatchable when zoomed out — the same trap the wall node
 * handles fell into. Visual sizes live in overlayDraw.ts, shared with the wall
 * node handles.
 */
const PICK_RADIUS_PX = 11;
/** An edge must be at least this long on screen to be worth an insert marker. */
const MIN_EDGE_FOR_INSERT_PX = 26;

let overlay: Graphics | null = null;
let lastSignature = '';
/** Key-hint chip riding next to the selected vertex. Created lazily: Text
 *  construction touches canvas text metrics the node test env lacks. */
let chip: Text | null = null;

export function initShapeNodeOverlay(graphics: Graphics): void {
  overlay = graphics;
  overlay.label = 'shapeNodeOverlay';
  lastSignature = '';
  chip?.destroy();
  chip = null;
}

function ensureChip(): Text | null {
  if (!overlay?.parent) return null;
  if (!chip) {
    chip = new Text({
      text: 'alt-drag bend · dbl-click smooth · Del remove',
      style: new TextStyle({
        fontFamily: 'IBM Plex Mono, Consolas, monospace',
        fontSize: 10,
        fill: 0xffffff,
      }),
      resolution: 2,
    });
    chip.label = 'shapeNodeChip';
    overlay.parent.addChild(chip);
  }
  return chip;
}

function currentTarget(): OutlineTarget | null {
  const id = useStore.getState().tools.shapeNodeEditId;
  if (!id) return null;
  return resolveOutline(id);
}

function hasTangents(vt: VertexTangents | null | undefined): boolean {
  return !!(vt && (vt.tin || vt.tout));
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Where edge i's insert puck sits: chord midpoint, or the curve's midpoint. */
function insertPointFor(
  outline: [number, number][],
  tangents: RingTangents | undefined,
  i: number,
): [number, number] {
  const a = outline[i];
  const b = outline[(i + 1) % outline.length];
  if (!edgeIsCurved(tangents?.[i], tangents?.[(i + 1) % outline.length])) return midpoint(a, b);
  const [c1, c2] = edgeControls(a, b, tangents?.[i], tangents?.[(i + 1) % outline.length]);
  return pointOnCubic(a, c1, c2, b, 0.5);
}

/**
 * Screen-space length an edge takes up, roughly: chord for straight edges, the
 * control polygon for curved ones — a balloon edge whose endpoints nearly touch
 * still deserves its insert marker.
 */
function edgeExtent(
  outline: [number, number][],
  tangents: RingTangents | undefined,
  i: number,
): number {
  const a = outline[i];
  const j = (i + 1) % outline.length;
  const b = outline[j];
  if (!edgeIsCurved(tangents?.[i], tangents?.[j])) return Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [c1, c2] = edgeControls(a, b, tangents?.[i], tangents?.[j]);
  return (
    Math.hypot(c1[0] - a[0], c1[1] - a[1]) +
    Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) +
    Math.hypot(b[0] - c2[0], b[1] - c2[1])
  );
}

/** The selected vertex and its two ring neighbours — the arms' audience. */
function armIndices(selected: number | null, n: number): Set<number> {
  if (selected === null || n === 0) return new Set();
  return new Set([(selected - 1 + n) % n, selected, (selected + 1) % n]);
}

export function renderShapeNodeHandles(
  zoom: number,
  view?: { x: number; y: number; width: number; height: number },
): void {
  if (!overlay) return;
  const state = useStore.getState();
  const target = currentTarget();
  const outline = target?.outline ?? null;
  const tangents = target?.tangents;
  const selected = state.tools.selectedVertex;

  const signature = outline
    ? [
        state.tools.shapeNodeEditId,
        selected ?? '',
        zoom.toFixed(3),
        outline.length,
        // The dim quad covers the camera rect, so panning must redraw it.
        view ? `${view.x.toFixed(2)},${view.y.toFixed(2)}` : '',
        // Coordinates, or dragging a vertex would not redraw its handle.
        outline.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';'),
        // Tangents too, or dragging a handle would not redraw the curve.
        JSON.stringify(tangents ?? null),
      ].join('|')
    : '';
  if (signature === lastSignature) return;
  lastSignature = signature;

  overlay.clear();
  if (!outline || outline.length < 3) {
    if (chip) chip.visible = false;
    return;
  }

  const safeZoom = zoom > 0 ? zoom : 1;
  const minEdge = MIN_EDGE_FOR_INSERT_PX / safeZoom;
  const n = outline.length;
  const flat = flattenRing(outline, tangents);

  // Everything else steps back 15% so the ring being edited carries the light.
  if (view) drawEditDim(overlay, view, flat);

  // The outline as a rope dash: provisional, being worked on — not geometry yet.
  strokeRopeDash(overlay, flat, true, zoom);

  // Insert markers first, so a vertex handle always wins the visual overlap.
  for (let i = 0; i < n; i++) {
    if (edgeExtent(outline, tangents, i) < minEdge) continue;
    const [mx, my] = insertPointFor(outline, tangents, i);
    drawInsertPuck(overlay, mx, my, zoom);
  }

  // Tangent arms under their anchors, on the selected vertex and neighbours.
  const arms = armIndices(selected, n);
  for (const i of arms) {
    const vt = tangents?.[i];
    if (!vt) continue;
    const [ax, ay] = outline[i];
    if (vt.tin) drawTangentArm(overlay, ax, ay, vt.tin[0], vt.tin[1], zoom);
    if (vt.tout) drawTangentArm(overlay, ax, ay, vt.tout[0], vt.tout[1], zoom);
  }

  // Corners are squares, smooth anchors circles — the pen-tool vocabulary.
  for (let i = 0; i < n; i++) {
    drawNodeHandle(overlay, outline[i][0], outline[i][1], zoom, {
      selected: selected === i,
      circle: hasTangents(tangents?.[i]),
    });
  }

  // The top keys ride next to the selected vertex — the status bar carries the
  // full map, this is the glanceable reminder at the point of action.
  const hint = ensureChip();
  if (hint) {
    hint.visible = selected !== null && selected < n;
    if (hint.visible && selected !== null) {
      const z = safeZoom;
      const [sx, sy] = outline[selected];
      hint.scale.set(1 / z);
      hint.position.set(sx + 14 / z, sy - 22 / z);
      const pad = 4 / z;
      // Text.width already includes the 1/z scale, so these are world units.
      const w = hint.width;
      const h = hint.height;
      overlay.roundRect(sx + 14 / z - pad, sy - 22 / z - pad / 2, w + pad * 2, h + pad, 3 / z);
      overlay.fill({ color: OVERLAY_INK, alpha: 0.85 });
    }
  }
}

export type OutlineHit =
  | { kind: 'vertex'; index: number }
  | { kind: 'insert'; index: number; x: number; y: number }
  | { kind: 'edge'; index: number }
  | { kind: 'tangent'; index: number; which: 'in' | 'out' };

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

/** Distance from `p` to edge i, following the curve when there is one. */
function distToEdge(
  p: Point,
  outline: [number, number][],
  tangents: RingTangents | undefined,
  i: number,
): number {
  const a = outline[i];
  const j = (i + 1) % outline.length;
  const b = outline[j];
  if (!edgeIsCurved(tangents?.[i], tangents?.[j])) return distToSegment(p, a, b);
  const [c1, c2] = edgeControls(a, b, tangents?.[i], tangents?.[j]);
  const poly: Vec2[] = [a, ...flattenCubic(a, c1, c2, b), b];
  let best = Infinity;
  for (let k = 0; k < poly.length - 1; k++) {
    const d = distToSegment(p, poly[k], poly[k + 1]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * What the pointer is over, in priority order: a tangent handle (drawn only
 * around the selection, so tested only there), then a vertex, then an insert
 * marker, then the edge itself. Vertices win over edges so a corner is never
 * mistaken for the run leading into it.
 */
export function outlineHitAt(world: Point, zoom: number): OutlineHit | null {
  const target = currentTarget();
  const outline = target?.outline;
  if (!outline || outline.length < 3) return null;
  const tangents = target?.tangents;
  const pick = PICK_RADIUS_PX / (zoom > 0 ? zoom : 1);
  const minEdge = MIN_EDGE_FOR_INSERT_PX / (zoom > 0 ? zoom : 1);
  const n = outline.length;

  const selected = useStore.getState().tools.selectedVertex;
  for (const i of armIndices(selected, n)) {
    const vt = tangents?.[i];
    if (!vt) continue;
    for (const which of ['in', 'out'] as const) {
      const tip = which === 'in' ? vt.tin : vt.tout;
      if (tip && Math.hypot(world.x - tip[0], world.y - tip[1]) < pick) {
        return { kind: 'tangent', index: i, which };
      }
    }
  }

  let best: { index: number; d: number } | null = null;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(world.x - outline[i][0], world.y - outline[i][1]);
    if (d < pick && (!best || d < best.d)) best = { index: i, d };
  }
  if (best) return { kind: 'vertex', index: best.index };

  for (let i = 0; i < n; i++) {
    if (edgeExtent(outline, tangents, i) < minEdge) continue;
    const [mx, my] = insertPointFor(outline, tangents, i);
    if (Math.hypot(world.x - mx, world.y - my) < pick) {
      return { kind: 'insert', index: i, x: mx, y: my };
    }
  }

  for (let i = 0; i < n; i++) {
    if (distToEdge(world, outline, tangents, i) < pick) return { kind: 'edge', index: i };
  }
  return null;
}
