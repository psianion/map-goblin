// The node editor for a path: with the path picked and node mode on, a handle at every node
// and a smaller one at every midpoint, as floors have. Dragging a node moves it; dragging a
// midpoint inserts a node there and drags it, so the line gains a bend. Each drag is one
// undo step. Moving the whole path is the Select tool's ordinary move.

import type { Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import { UpdateChildCommand } from '../store/commands';
import type { DungeonLayer, PathwayChild } from '../store/types';
import type { Point } from '../types/geometry';
import { effectiveContours } from './tools/childTransform';
import { pathwayLine } from '../shared/pathway';
import { drawInsertPuck, drawNodeHandle, strokeRopeDash } from './overlayDraw';

const PICK_PX = 10;

interface EditedPath {
  layerId: string;
  path: PathwayChild;
}

/** The path in node mode: the one picked, with node mode on for it, editable. */
export function editedPath(): EditedPath | null {
  const s = useStore.getState();
  const id = s.tools.pathNodeEditId;
  if (!id || s.tools.activeTool !== 'select' || s.selection.selectedIds.length !== 1 || s.selection.selectedIds[0] !== id) return null;
  for (const l of s.layers) {
    if (l.type !== 'dungeon') continue;
    const c = (l as DungeonLayer).children.find((x) => x.id === id);
    if (!c) continue;
    if (c.childType !== 'pathway' || !c.visible || c.locked || l.locked || !l.visible) return null;
    return { layerId: l.id, path: c };
  }
  return null;
}

/** The path's nodes in world space, its transform folded in. */
export function pathNodes(p: Pick<PathwayChild, 'contours' | 'transform'>): [number, number][] {
  return (effectiveContours(p)[0] ?? []).map(([x, y]): [number, number] => [x, y]);
}

/** Where node `i`'s midpoint handle sits: halfway along the edge to the next node. */
const midpointOf = (nodes: readonly [number, number][], i: number): [number, number] => [
  (nodes[i][0] + nodes[i + 1][0]) / 2,
  (nodes[i][1] + nodes[i + 1][1]) / 2,
];

export type PathHit = { kind: 'node'; index: number } | { kind: 'mid'; index: number };

/** A node within `r` of `world`, else a midpoint; nodes win. */
export function pathHitAt(nodes: readonly [number, number][], world: Point, r: number): PathHit | null {
  const near = ([x, y]: [number, number]) => Math.hypot(world.x - x, world.y - y) <= r;
  for (let i = 0; i < nodes.length; i++) if (near(nodes[i])) return { kind: 'node', index: i };
  for (let i = 0; i < nodes.length - 1; i++) if (near(midpointOf(nodes, i))) return { kind: 'mid', index: i };
  return null;
}

/** The nodes with a midpoint's drag applied: a new node after `index`, at `at`. */
export function insertNode(nodes: readonly [number, number][], index: number, at: [number, number]): [number, number][] {
  const next = nodes.map((n): [number, number] => [n[0], n[1]]);
  next.splice(index + 1, 0, at);
  return next;
}

interface PathDrag {
  layerId: string;
  id: string;
  /** The node being dragged, in `nodes`. */
  index: number;
  nodes: [number, number][];
  before: Pick<PathwayChild, 'contours' | 'transform'>;
  label: string;
}

let drag: PathDrag | null = null;

export function isDraggingPath(): boolean {
  return drag !== null;
}

function snapToGrid(point: Point): Point {
  const { snapEnabled, snapDivision } = useStore.getState().grid;
  if (!snapEnabled) return point;
  const interval = 1 / snapDivision;
  return { x: Math.round(point.x / interval) * interval, y: Math.round(point.y / interval) * interval };
}

const fields = (nodes: [number, number][]): Pick<PathwayChild, 'contours' | 'transform'> => ({ contours: [nodes], transform: undefined });

function livePath(layerId: string, id: string): PathwayChild | undefined {
  const l = useStore.getState().layers.find((x) => x.id === layerId) as DungeonLayer | undefined;
  return l?.children.find((c): c is PathwayChild => c.id === id && c.childType === 'pathway');
}

/** A press on the edited path: a node starts its drag, a midpoint inserts a node and drags it. False on a miss. */
export function pressPath(world: Point, zoom: number): boolean {
  const e = editedPath();
  if (!e) return false;
  const nodes = pathNodes(e.path);
  const hit = pathHitAt(nodes, world, PICK_PX / (zoom > 0 ? zoom : 1));
  if (!hit) return false;
  const before = structuredClone({ contours: e.path.contours, transform: e.path.transform });
  if (hit.kind === 'mid') {
    drag = { layerId: e.layerId, id: e.path.id, index: hit.index + 1, nodes: insertNode(nodes, hit.index, midpointOf(nodes, hit.index)), before, label: 'Add path node' };
  } else {
    drag = { layerId: e.layerId, id: e.path.id, index: hit.index, nodes, before, label: 'Move path node' };
  }
  useStore.getState().updateChild(e.layerId, e.path.id, fields(drag.nodes));
  return true;
}

export function movePathDrag(world: Point): void {
  if (!drag || !livePath(drag.layerId, drag.id)) return;
  const at = snapToGrid(world);
  const nodes = drag.nodes.map((n): [number, number] => [n[0], n[1]]);
  nodes[drag.index] = [at.x, at.y];
  useStore.getState().updateChild(drag.layerId, drag.id, fields(nodes));
}

/** The drag lands as one undo step; none when nothing moved. */
export function endPathDrag(): void {
  const d = drag;
  drag = null;
  const now = d && livePath(d.layerId, d.id);
  if (!d || !now) return;
  const after = structuredClone({ contours: now.contours, transform: now.transform });
  // The live preview is put back first, so the command's own execute is the one write.
  useStore.getState().updateChild(d.layerId, d.id, d.before);
  if (JSON.stringify(after) === JSON.stringify(d.before)) return;
  undoManager.execute(new UpdateChildCommand(d.label, d.layerId, d.id, d.before, after));
}

export function cancelPathDrag(): void {
  const d = drag;
  drag = null;
  if (d && livePath(d.layerId, d.id)) useStore.getState().updateChild(d.layerId, d.id, d.before);
}

// ─── Overlay ────────────────────────────────────────────────

let overlay: Graphics | null = null;
let lastSignature = '';

export function initPathNodeOverlay(graphics: Graphics): void {
  overlay = graphics;
  overlay.label = 'pathNodeOverlay';
  lastSignature = '';
}

/** The edited path's line, a midpoint handle on every edge and a handle on every node. */
export function renderPathNodeHandles(zoom: number): void {
  if (!overlay) return;
  const e = editedPath();
  const signature = e ? `${e.path.id}|${zoom.toFixed(3)}|${JSON.stringify([e.path.contours, e.path.transform, e.path.curve, e.path.smoothness])}` : '';
  if (signature === lastSignature) return;
  lastSignature = signature;
  overlay.clear();
  if (!e) return;
  const line = pathwayLine(e.path);
  if (line.length >= 2) strokeRopeDash(overlay, line, false, zoom);
  const nodes = pathNodes(e.path);
  for (let i = 0; i < nodes.length - 1; i++) {
    const [mx, my] = midpointOf(nodes, i);
    drawInsertPuck(overlay, mx, my, zoom);
  }
  for (const [x, y] of nodes) drawNodeHandle(overlay, x, y, zoom, {});
}
