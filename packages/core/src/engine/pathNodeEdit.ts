// Editing a selected path on the canvas with the Select tool: its points, their curve
// handles, a width handle either side of each point and, in Set height mode, a ± per point.
//
// Same furniture as the outline editor (overlayDraw.ts), in world space, sized in screen
// pixels. A drag previews straight into the store and lands as one undo entry when it ends;
// clicks (insert, ±) and the wheel go through the path commands, the wheel coalescing.

import type { Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import { UpdateChildCommand } from '../store/commands';
import {
  insertPathPoint,
  removePathPoint,
  setPathPointHandles,
  setPathPointHeight,
  setPathPointWidth,
} from '../store/pathCommands';
import type { DungeonLayer } from '../store/types';
import type { PathChild, PathPoint } from '../shared/types';
import type { Point } from '../types/geometry';
import { pathCentreline } from '../geometry/pathGeometry';
import { drawInsertPuck, drawNodeHandle, drawTangentArm, strokeRopeDash } from './overlayDraw';
import { OVERLAY_INK, OVERLAY_WHITE } from './overlayPalette';
import { PATH_WIDTH_FINE_STEP, PATH_WIDTH_RANGE, PATH_WIDTH_STEP, snapPathPoint } from './tools/PathTool';

const PICK_PX = 10;
/** The ± markers sit this far above and below their point, screen px. */
const HEIGHT_OFFSET_PX = 18;

export type PathHit =
  | { kind: 'point'; index: number }
  | { kind: 'handle'; index: number; which: 'in' | 'out' }
  | { kind: 'width'; index: number }
  | { kind: 'height'; index: number; dir: 1 | -1 }
  | { kind: 'insert'; index: number; x: number; y: number };

interface Edited {
  layerId: string;
  path: PathChild;
}

/** The path the Select tool is editing: the selection is exactly one editable path. */
export function editedPath(): Edited | null {
  const s = useStore.getState();
  if (s.tools.activeTool !== 'select' || s.selection.selectedIds.length !== 1) return null;
  const id = s.selection.selectedIds[0];
  for (const l of s.layers) {
    if (l.type !== 'dungeon') continue;
    const c = (l as DungeonLayer).children.find((x) => x.id === id);
    if (!c) continue;
    if (c.childType !== 'path' || !c.visible || c.locked || l.locked || !l.visible) return null;
    return { layerId: l.id, path: c };
  }
  return null;
}

/** Where on the centreline point `i` sits, its unit normal, and the drawn width there. */
function frameAt(path: PathChild, i: number): { n: [number, number]; width: number } {
  const line = pathCentreline(path);
  const s = line.pointArc[i] ?? 0;
  let j = 0;
  while (j < line.arc.length - 1 && line.arc[j] < s - 1e-9) j++;
  const a = line.xy[Math.max(0, j - 1)];
  const b = line.xy[Math.min(line.xy.length - 1, j + 1)];
  const dx = b ? b[0] - a[0] : 1;
  const dy = b ? b[1] - a[1] : 0;
  const len = Math.hypot(dx, dy) || 1;
  return { n: [-dy / len, dx / len], width: line.width[j] ?? path.width };
}

function widthHandle(path: PathChild, i: number): [number, number] {
  const p = path.points[i];
  const { n, width } = frameAt(path, i);
  return [p.x + (n[0] * width) / 2, p.y + (n[1] * width) / 2];
}

/** What the pointer is over on the edited path, closest kind first. */
export function pathHitAt(world: Point, zoom: number): PathHit | null {
  const e = editedPath();
  if (!e) return null;
  const { path } = e;
  const r = PICK_PX / (zoom > 0 ? zoom : 1);
  const near = (x: number, y: number) => Math.hypot(world.x - x, world.y - y) <= r;
  const pts = path.points;
  if (path.heightMode === 'set') {
    const off = HEIGHT_OFFSET_PX / (zoom > 0 ? zoom : 1);
    for (let i = 0; i < pts.length; i++) {
      if (near(pts[i].x, pts[i].y - off)) return { kind: 'height', index: i, dir: 1 };
      if (near(pts[i].x, pts[i].y + off)) return { kind: 'height', index: i, dir: -1 };
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const h = pts[i].handles;
    if (!h) continue;
    if (near(pts[i].x + h.out[0], pts[i].y + h.out[1])) return { kind: 'handle', index: i, which: 'out' };
    if (near(pts[i].x + h.in[0], pts[i].y + h.in[1])) return { kind: 'handle', index: i, which: 'in' };
  }
  for (let i = 0; i < pts.length; i++) if (near(pts[i].x, pts[i].y)) return { kind: 'point', index: i };
  for (let i = 0; i < pts.length; i++) {
    const [wx, wy] = widthHandle(path, i);
    if (near(wx, wy)) return { kind: 'width', index: i };
  }
  // On the centreline: a click there adds a point.
  const line = pathCentreline(path);
  let best = Infinity;
  let at: { s: number; x: number; y: number } | null = null;
  for (let k = 0; k < line.xy.length - 1; k++) {
    const [ax, ay] = line.xy[k];
    const [bx, by] = line.xy[k + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((world.x - ax) * dx + (world.y - ay) * dy) / l2));
    const x = ax + dx * t;
    const y = ay + dy * t;
    const d = Math.hypot(world.x - x, world.y - y);
    if (d < best) {
      best = d;
      at = { s: line.arc[k] + (line.arc[k + 1] - line.arc[k]) * t, x, y };
    }
  }
  if (!at || best > r) return null;
  let index = line.pointArc.findIndex((s, i) => i > 0 && s > at.s);
  if (index < 0) index = pts.length;
  return { kind: 'insert', index, x: at.x, y: at.y };
}

// ─── Drags ──────────────────────────────────────────────────

interface Drag {
  layerId: string;
  pathId: string;
  kind: 'point' | 'pull' | 'handle' | 'width';
  index: number;
  which?: 'in' | 'out';
  /** Shift on a width handle: every width scales together. */
  scaleAll: boolean;
  before: { points: PathPoint[]; width: number };
  label: string;
}

let drag: Drag | null = null;
let hovered: number | null = null;

export function isDraggingPath(): boolean {
  return drag !== null;
}

/**
 * A press on the edited path. Point, handle and width hits start a drag (Alt on a point
 * pulls its handles out); a ± or an insert acts at once. False when nothing was hit.
 */
export function pressPath(world: Point, zoom: number, mods: { alt: boolean; shift: boolean }): boolean {
  const e = editedPath();
  const hit = pathHitAt(world, zoom);
  if (!e || !hit) return false;
  const { path, layerId } = e;
  if (hit.kind === 'height') {
    const p = path.points[hit.index];
    const cmd = setPathPointHeight(path.id, hit.index, (p.height ?? 0) + hit.dir);
    if (cmd) undoManager.execute(cmd);
    return true;
  }
  if (hit.kind === 'insert') {
    const cmd = insertPathPoint(path.id, hit.index, { x: hit.x, y: hit.y });
    if (cmd) undoManager.execute(cmd);
    return true;
  }
  const kind = hit.kind === 'point' ? (mods.alt ? 'pull' : 'point') : hit.kind;
  drag = {
    layerId,
    pathId: path.id,
    kind,
    index: hit.index,
    which: hit.kind === 'handle' ? hit.which : undefined,
    scaleAll: hit.kind === 'width' && mods.shift,
    before: { points: structuredClone(path.points), width: path.width },
    label: kind === 'point' ? 'Move point' : kind === 'width' ? 'Path width' : 'Point handles',
  };
  return true;
}

const clampWidth = (w: number) => Math.min(PATH_WIDTH_RANGE.max, Math.max(0.1, Math.round(w * 100) / 100));

/** The drag's patch for the pointer at `world`. */
function dragPatch(d: Drag, world: Point): { points: PathPoint[]; width?: number } {
  const points = structuredClone(d.before.points);
  const p = points[d.index];
  if (d.kind === 'point') {
    const at = snapPathPoint(world, d.layerId);
    points[d.index] = { ...p, x: at.x, y: at.y };
    return { points };
  }
  if (d.kind === 'pull' || d.kind === 'handle') {
    const v: [number, number] = [world.x - p.x, world.y - p.y];
    const mirrored: [number, number] = [-v[0], -v[1]];
    const which = d.which ?? 'out';
    const h = p.handles ?? { in: mirrored, out: v };
    points[d.index] = {
      ...p,
      handles: which === 'out' ? { in: d.kind === 'pull' ? mirrored : h.in, out: v } : { in: v, out: h.out },
    };
    return { points };
  }
  // Width: twice the pointer's distance from the point across the path.
  const path = { ...currentPath(d), points: d.before.points, width: d.before.width };
  const { n, width: drawn } = frameAt(path, d.index);
  const w = clampWidth(Math.abs((world.x - p.x) * n[0] + (world.y - p.y) * n[1]) * 2);
  if (!d.scaleAll) {
    points[d.index] = { ...p, width: w };
    return { points };
  }
  const k = w / (drawn || 1);
  return {
    width: clampWidth(d.before.width * k),
    points: points.map((q) => (q.width === undefined ? q : { ...q, width: clampWidth(q.width * k) })),
  };
}

function currentPath(d: Drag): PathChild {
  const l = useStore.getState().layers.find((x) => x.id === d.layerId) as DungeonLayer | undefined;
  return l?.children.find((c) => c.id === d.pathId) as PathChild;
}

export function movePathDrag(world: Point): void {
  if (!drag || !currentPath(drag)) return;
  useStore.getState().updateChild(drag.layerId, drag.pathId, dragPatch(drag, world));
}

/** The drag lands as one undo entry, or none when nothing moved. */
export function endPathDrag(): void {
  const d = drag;
  drag = null;
  const now = d && currentPath(d);
  if (!d || !now) return;
  const after = { points: now.points, width: now.width };
  if (JSON.stringify(after) === JSON.stringify(d.before)) return;
  undoManager.execute(new UpdateChildCommand(d.label, d.layerId, d.pathId, d.before, after));
}

export function cancelPathDrag(): void {
  const d = drag;
  drag = null;
  if (d && currentPath(d)) useStore.getState().updateChild(d.layerId, d.pathId, d.before);
}

// ─── Hover, wheel, double-click, Delete ─────────────────────

/** Tracks the point under the pointer, for Delete and the wheel. */
export function hoverPath(world: Point, zoom: number): void {
  const hit = pathHitAt(world, zoom);
  hovered = hit && (hit.kind === 'point' || hit.kind === 'width') ? hit.index : null;
}

/** The wheel over a point or its width handle steps that point's width. True when taken. */
export function wheelPath(world: Point, zoom: number, deltaY: number, fine: boolean): boolean {
  const e = editedPath();
  const hit = pathHitAt(world, zoom);
  if (!e || !hit || (hit.kind !== 'point' && hit.kind !== 'width')) return false;
  const now = e.path.points[hit.index].width ?? frameAt(e.path, hit.index).width;
  const step = (fine ? PATH_WIDTH_FINE_STEP : PATH_WIDTH_STEP) * (deltaY < 0 ? 1 : -1);
  const next = Math.min(PATH_WIDTH_RANGE.max, Math.max(PATH_WIDTH_RANGE.min, Math.round((now + step) * 100) / 100));
  const cmd = setPathPointWidth(e.path.id, hit.index, next);
  if (cmd) undoManager.execute(cmd);
  return true;
}

/** A double-click on a point turns it sharp, or back to a smooth auto curve. True when taken. */
export function togglePathPointAt(world: Point, zoom: number): boolean {
  const e = editedPath();
  const hit = pathHitAt(world, zoom);
  if (!e || hit?.kind !== 'point') return false;
  const sharp = e.path.points[hit.index].handles === null;
  const cmd = setPathPointHandles(e.path.id, hit.index, sharp ? undefined : null);
  if (cmd) undoManager.execute(cmd);
  return true;
}

/** Delete with the pointer on a point removes the point, not the path. True when taken. */
export function removeHoveredPathPoint(): boolean {
  const e = editedPath();
  if (!e || hovered === null || hovered >= e.path.points.length) return false;
  const cmd = removePathPoint(e.path.id, hovered);
  hovered = null;
  if (cmd) undoManager.execute(cmd);
  return true;
}

// ─── Overlay ────────────────────────────────────────────────

let overlay: Graphics | null = null;
let lastSignature = '';

export function initPathNodeOverlay(graphics: Graphics): void {
  overlay = graphics;
  overlay.label = 'pathNodeOverlay';
  lastSignature = '';
}

export function renderPathNodeHandles(zoom: number): void {
  if (!overlay) return;
  const e = editedPath();
  const signature = e ? `${e.path.id}|${zoom.toFixed(3)}|${hovered}|${JSON.stringify(e.path.points)}|${e.path.width}|${e.path.heightMode}|${e.path.closed}` : '';
  if (signature === lastSignature) return;
  lastSignature = signature;
  overlay.clear();
  if (!e) return;
  const { path } = e;
  const z = zoom > 0 ? zoom : 1;
  const line = pathCentreline(path);
  if (line.xy.length >= 2) strokeRopeDash(overlay, line.xy, false, zoom);
  path.points.forEach((p, i) => {
    if (p.handles) {
      drawTangentArm(overlay!, p.x, p.y, p.x + p.handles.in[0], p.y + p.handles.in[1], zoom);
      drawTangentArm(overlay!, p.x, p.y, p.x + p.handles.out[0], p.y + p.handles.out[1], zoom);
    }
    const [wx, wy] = widthHandle(path, i);
    overlay!.moveTo(p.x, p.y);
    overlay!.lineTo(wx, wy);
    overlay!.stroke({ color: OVERLAY_WHITE, width: 1 / z, alpha: 0.8 });
    drawInsertPuck(overlay!, wx, wy, zoom);
    drawNodeHandle(overlay!, p.x, p.y, zoom, { selected: hovered === i, circle: p.handles !== null });
    if (path.heightMode === 'set') {
      const off = HEIGHT_OFFSET_PX / z;
      for (const dir of [1, -1] as const) {
        const cy = p.y - dir * off;
        overlay!.circle(p.x, cy, 6 / z);
        overlay!.fill({ color: OVERLAY_INK, alpha: 0.8 });
        overlay!.moveTo(p.x - 3 / z, cy);
        overlay!.lineTo(p.x + 3 / z, cy);
        if (dir === 1) {
          overlay!.moveTo(p.x, cy - 3 / z);
          overlay!.lineTo(p.x, cy + 3 / z);
        }
        overlay!.stroke({ color: OVERLAY_WHITE, width: 1.25 / z, alpha: 1 });
      }
    }
  });
}
