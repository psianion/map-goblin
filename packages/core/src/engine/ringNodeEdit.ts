// The node editor paths and plateaus share: what the pointer is over among a chain's points,
// their curve handles and the line between them, and what a drag of a point or a handle does.
// Pure: pathNodeEdit.ts drives it for a path's points, and below for a plateau's ring.
//
// A plateau's ring is edited with the Select tool, one plateau selected: drag a point or a
// handle, click the edge to insert a point, Delete with the pointer on one removes it (a ring
// keeps three), double-click turns a point sharp or smooth. A drag that would leave the ring
// off ground is put back (engine/plateauGround.ts).

import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import { UpdateChildCommand } from '../store/commands';
import type { DungeonLayer, PlateauChild } from '../store/types';
import type { Point } from '../types/geometry';
import { flattenCubic, type RingTangents } from '../shared/bezier';
import { notify } from '../shared/notify';
import { GROUND_MESSAGE, SMALL_MESSAGE } from '../shared/plateauGround';
import { effectiveContours, effectiveTangents } from './tools/childTransform';
import { plateauGround } from './plateauGround';

/** A point of a chain and its curve handles, relative to it; null or absent = none drawn. */
export interface RingNode {
  x: number;
  y: number;
  handles?: { in: [number, number]; out: [number, number] } | null;
}

/** The chain drawn as a polyline, with where each node falls along it (arc length). */
export interface NodeLine {
  xy: [number, number][];
  arc: number[];
  nodeArc: number[];
}

export type NodeHit =
  | { kind: 'point'; index: number }
  | { kind: 'handle'; index: number; which: 'in' | 'out' }
  | { kind: 'insert'; index: number; x: number; y: number };

/** A handle (out first) or a point within `r` of `world`, handles before points. */
export function nodeHitAt(nodes: readonly RingNode[], world: Point, r: number): Extract<NodeHit, { kind: 'point' | 'handle' }> | null {
  const near = (x: number, y: number) => Math.hypot(world.x - x, world.y - y) <= r;
  for (let i = 0; i < nodes.length; i++) {
    const h = nodes[i].handles;
    if (!h) continue;
    if (near(nodes[i].x + h.out[0], nodes[i].y + h.out[1])) return { kind: 'handle', index: i, which: 'out' };
    if (near(nodes[i].x + h.in[0], nodes[i].y + h.in[1])) return { kind: 'handle', index: i, which: 'in' };
  }
  for (let i = 0; i < nodes.length; i++) if (near(nodes[i].x, nodes[i].y)) return { kind: 'point', index: i };
  return null;
}

/** Where a click on the line within `r` inserts a point: before the first node past it. */
export function insertHitAt(line: NodeLine, nodeCount: number, world: Point, r: number): Extract<NodeHit, { kind: 'insert' }> | null {
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
  let index = line.nodeArc.findIndex((s, i) => i > 0 && s > at.s);
  if (index < 0) index = nodeCount;
  return { kind: 'insert', index, x: at.x, y: at.y };
}

/**
 * A handle dragged to `world`: `which` follows the pointer; pulling (Alt on a point) mirrors
 * the other, a plain handle drag leaves it. A node with no handles gets them mirrored.
 */
export function draggedHandles(node: RingNode, world: Point, which: 'in' | 'out', pull: boolean): RingNode {
  const v: [number, number] = [world.x - node.x, world.y - node.y];
  const mirrored: [number, number] = [-v[0], -v[1]];
  const h = node.handles ?? { in: mirrored, out: v };
  return {
    ...node,
    handles: which === 'out' ? { in: pull ? mirrored : h.in, out: v } : { in: v, out: pull ? mirrored : h.out },
  };
}

// ─── A plateau's ring ───────────────────────────────────────

const PICK_PX = 10;

interface EditedPlateau {
  layerId: string;
  plateau: PlateauChild;
}

/** The plateau the Select tool is editing: the selection is exactly one editable plateau. */
export function editedPlateau(): EditedPlateau | null {
  const s = useStore.getState();
  if (s.tools.activeTool !== 'select' || s.selection.selectedIds.length !== 1) return null;
  const id = s.selection.selectedIds[0];
  for (const l of s.layers) {
    if (l.type !== 'dungeon') continue;
    const c = (l as DungeonLayer).children.find((x) => x.id === id);
    if (!c) continue;
    if (c.childType !== 'plateau' || !c.visible || c.locked || l.locked || !l.visible) return null;
    return { layerId: l.id, plateau: c };
  }
  return null;
}

/**
 * A plateau's outer ring as nodes, in world space (its transform folded in). A ring's
 * tangents are absolute points; a node's handles are offsets from it, as a path point's are.
 */
export function plateauNodes(p: Pick<PlateauChild, 'contours' | 'tangents' | 'transform'>): RingNode[] {
  const ring = effectiveContours(p)[0] ?? [];
  const tans = effectiveTangents(p)?.[0];
  return ring.map(([x, y], i) => {
    const t = tans?.[i];
    if (!t || (!t.tin && !t.tout)) return { x, y, handles: null };
    const rel = (q: [number, number] | undefined): [number, number] => (q ? [q[0] - x, q[1] - y] : [0, 0]);
    return { x, y, handles: { in: rel(t.tin), out: rel(t.tout) } };
  });
}

/** The ring's tangents for nodes, absolute again; none at all for a ring with no handles. */
function nodeTangents(nodes: readonly RingNode[]): RingTangents | undefined {
  const tangents: RingTangents = nodes.map((n) =>
    n.handles ? { tin: [n.x + n.handles.in[0], n.y + n.handles.in[1]], tout: [n.x + n.handles.out[0], n.y + n.handles.out[1]] } : null,
  );
  return tangents.some(Boolean) ? tangents : undefined;
}

/** Nodes back to a plateau's ring fields, transform folded away. */
export function nodesToRing(nodes: readonly RingNode[]): Pick<PlateauChild, 'contours' | 'tangents' | 'transform'> {
  const contour = nodes.map((n): [number, number] => [n.x, n.y]);
  const tangents = nodeTangents(nodes);
  return { contours: [contour], tangents: tangents ? [tangents] : undefined, transform: undefined };
}

/** The ring drawn as a closed polyline, curves flattened, and where each node falls on it. */
export function ringLine(nodes: readonly RingNode[]): NodeLine {
  const xy: [number, number][] = [];
  const arc: number[] = [];
  const nodeArc: number[] = [];
  const n = nodes.length;
  const tans = nodeTangents(nodes);
  let s = 0;
  const push = (p: [number, number]) => {
    if (xy.length > 0) s += Math.hypot(p[0] - xy[xy.length - 1][0], p[1] - xy[xy.length - 1][1]);
    xy.push(p);
    arc.push(s);
  };
  for (let i = 0; i < n; i++) {
    nodeArc.push(s);
    const a: [number, number] = [nodes[i].x, nodes[i].y];
    const b: [number, number] = [nodes[(i + 1) % n].x, nodes[(i + 1) % n].y];
    if (i === 0) push(a);
    const tout = tans?.[i]?.tout;
    const tin = tans?.[(i + 1) % n]?.tin;
    if (tout || tin) for (const p of flattenCubic(a, tout ?? a, tin ?? b, b)) push(p as [number, number]);
    push(b);
  }
  return { xy, arc, nodeArc };
}

export type PlateauHit = NodeHit;

/** What the pointer is over on the edited plateau's ring: a handle, a point, else its edge. */
export function plateauHitAt(world: Point, zoom: number): PlateauHit | null {
  const e = editedPlateau();
  if (!e) return null;
  const nodes = plateauNodes(e.plateau);
  const r = PICK_PX / (zoom > 0 ? zoom : 1);
  return nodeHitAt(nodes, world, r) ?? insertHitAt(ringLine(nodes), nodes.length, world, r);
}

interface RingDrag {
  layerId: string;
  id: string;
  kind: 'point' | 'pull' | 'handle';
  index: number;
  which?: 'in' | 'out';
  nodes: RingNode[];
  before: Pick<PlateauChild, 'contours' | 'tangents' | 'transform'>;
  label: string;
}

let ringDrag: RingDrag | null = null;
let ringHovered: number | null = null;

export function isDraggingPlateau(): boolean {
  return ringDrag !== null;
}

/** The point on the grid when snap is on. */
function snapToGrid(point: Point): Point {
  const { snapEnabled, snapDivision } = useStore.getState().grid;
  if (!snapEnabled) return point;
  const interval = 1 / snapDivision;
  return { x: Math.round(point.x / interval) * interval, y: Math.round(point.y / interval) * interval };
}

const ringFields = (p: PlateauChild): Pick<PlateauChild, 'contours' | 'tangents' | 'transform'> =>
  structuredClone({ contours: p.contours, tangents: p.tangents, transform: p.transform });

function livePlateau(layerId: string, id: string): PlateauChild | undefined {
  const l = useStore.getState().layers.find((x) => x.id === layerId) as DungeonLayer | undefined;
  return l?.children.find((c): c is PlateauChild => c.id === id && c.childType === 'plateau');
}

/**
 * Lands a ring edit as one undo entry when the ring still stands on ground, else puts the
 * plateau back as `before` with a toast. Resolves to whether it landed.
 */
export async function commitPlateauRing(
  layerId: string,
  id: string,
  label: string,
  before: Pick<PlateauChild, 'contours' | 'tangents' | 'transform'>,
  after: Pick<PlateauChild, 'contours' | 'tangents' | 'transform'>,
): Promise<boolean> {
  const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layerId && l.type === 'dungeon');
  if (!layer) return false;
  const ring = effectiveContours(after)[0] ?? [];
  const verdict = await plateauGround(layer, ring);
  if (verdict !== 'ok') {
    if (livePlateau(layerId, id)) useStore.getState().updateChild(layerId, id, before);
    notify.warning(verdict === 'small' ? SMALL_MESSAGE : GROUND_MESSAGE);
    return false;
  }
  if (!livePlateau(layerId, id)) return false;
  // The live preview is put back first, so the command's own execute is the one write.
  useStore.getState().updateChild(layerId, id, before);
  undoManager.execute(new UpdateChildCommand(label, layerId, id, before, after));
  return true;
}

/**
 * A press on the edited plateau. Point and handle hits start a drag (Alt on a point pulls its
 * handles out); a click on the edge inserts a point at once. False when nothing was hit.
 */
export function pressPlateau(world: Point, zoom: number, mods: { alt: boolean }): boolean {
  const e = editedPlateau();
  const hit = plateauHitAt(world, zoom);
  if (!e || !hit) return false;
  const nodes = plateauNodes(e.plateau);
  if (hit.kind === 'insert') {
    const next = [...nodes];
    next.splice(hit.index, 0, { x: hit.x, y: hit.y, handles: null });
    void commitPlateauRing(e.layerId, e.plateau.id, 'Add point', ringFields(e.plateau), nodesToRing(next));
    return true;
  }
  const kind = hit.kind === 'point' ? (mods.alt ? 'pull' : 'point') : 'handle';
  ringDrag = {
    layerId: e.layerId,
    id: e.plateau.id,
    kind,
    index: hit.index,
    which: hit.kind === 'handle' ? hit.which : undefined,
    nodes,
    before: ringFields(e.plateau),
    label: kind === 'point' ? 'Move point' : 'Point handles',
  };
  return true;
}

/** The drag's nodes for the pointer at `world`. */
function draggedNodes(d: RingDrag, world: Point): RingNode[] {
  const nodes = d.nodes.map((n) => ({ ...n }));
  const n = nodes[d.index];
  if (d.kind === 'point') {
    const at = snapToGrid(world);
    nodes[d.index] = { ...n, x: at.x, y: at.y };
  } else {
    nodes[d.index] = draggedHandles(n, world, d.which ?? 'out', d.kind === 'pull');
  }
  return nodes;
}

export function movePlateauDrag(world: Point): void {
  if (!ringDrag || !livePlateau(ringDrag.layerId, ringDrag.id)) return;
  useStore.getState().updateChild(ringDrag.layerId, ringDrag.id, nodesToRing(draggedNodes(ringDrag, world)));
}

/** The drag lands as one undo entry, or is put back when it leaves ground; none when nothing moved. */
export function endPlateauDrag(): void {
  const d = ringDrag;
  ringDrag = null;
  const now = d && livePlateau(d.layerId, d.id);
  if (!d || !now) return;
  const after = ringFields(now);
  if (JSON.stringify(after) === JSON.stringify(d.before)) return;
  void commitPlateauRing(d.layerId, d.id, d.label, d.before, after);
}

export function cancelPlateauDrag(): void {
  const d = ringDrag;
  ringDrag = null;
  if (d && livePlateau(d.layerId, d.id)) useStore.getState().updateChild(d.layerId, d.id, d.before);
}

/** Tracks the point under the pointer, for Delete. */
export function hoverPlateau(world: Point, zoom: number): void {
  const hit = plateauHitAt(world, zoom);
  ringHovered = hit?.kind === 'point' ? hit.index : null;
}

export function hoveredPlateauPoint(): number | null {
  return ringHovered;
}

/** A double-click on a point turns it sharp, or smooth with handles along its neighbours. True when taken. */
export function togglePlateauPointAt(world: Point, zoom: number): boolean {
  const e = editedPlateau();
  const hit = plateauHitAt(world, zoom);
  if (!e || hit?.kind !== 'point') return false;
  const nodes = plateauNodes(e.plateau);
  const n = nodes[hit.index];
  if (n.handles) {
    nodes[hit.index] = { ...n, handles: null };
  } else {
    const prev = nodes[(hit.index - 1 + nodes.length) % nodes.length];
    const next = nodes[(hit.index + 1) % nodes.length];
    const t: [number, number] = [(next.x - prev.x) / 6, (next.y - prev.y) / 6];
    nodes[hit.index] = { ...n, handles: { in: [-t[0], -t[1]], out: t } };
  }
  void commitPlateauRing(e.layerId, e.plateau.id, 'Point handles', ringFields(e.plateau), nodesToRing(nodes));
  return true;
}

/** Delete with the pointer on a point removes the point, not the plateau (a ring keeps three). True when taken. */
export function removeHoveredPlateauPoint(): boolean {
  const e = editedPlateau();
  if (!e || ringHovered === null) return false;
  const nodes = plateauNodes(e.plateau);
  const index = ringHovered;
  ringHovered = null;
  if (index >= nodes.length) return false;
  if (nodes.length <= 3) return true;
  nodes.splice(index, 1);
  void commitPlateauRing(e.layerId, e.plateau.id, 'Remove point', ringFields(e.plateau), nodesToRing(nodes));
  return true;
}
