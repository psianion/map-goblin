// One way to move, turn, mirror and resize anything the Select tool can hold.
//
// A `TransformTarget` wraps one selected object, child or drawn wall, as it was when the
// gesture or key began: its world box, an `edit` for a similarity transform, a `flip`
// about its own centre, and a live preview the gizmo writes off the undo stack. The gizmo,
// the nudge keys, flip, Rotate 90°, align, distribute and the duplicate drag all build
// their one undo entry from these edits with `editsCommand`, so walls and zones answer to
// every verb the props always had, and the doors on a moved wall come along, re-sealed.

import type { AnyChild, Command, DoorChild, DungeonLayer, Layer, WallSegment } from '../store/types';
import { useStore } from '../store/store';
import { CompositeCommand, SetRoomAnchorCommand, UpdateChildCommand, UpdateWallCommand } from '../store/commands';
import { createPropPatchCommand, type AlignEdge, type PropPatch } from '../store/propEdits';
import { doorwayEditCommand } from '../store/doorwayCommands';
import { isLockedObject, resolveSelection } from '../store/selectionResolve';
import { flattenRing } from '../shared/bezier';
import { projectPointOntoLineSegment } from '../shared/wallSnap';
import { pointInRing } from '../shared/roomUtils';
import {
  doorsOnWall,
  mapDoorPose,
  mapWallPoints,
  mirrorMap,
  planWallEdits,
  wallCentre,
  type PointMap,
  type Pt,
} from '../shared/wallTransform';
import { getChildBounds, getChildFootprint, getWallBounds, wallReach } from './hitTest';
import {
  isIdentity,
  mapPoint,
  snapshotChild,
  transformChild,
  type ChildSnapshot,
  type WorldBox,
  type WorldTransform,
} from './tools/childTransform';

export type TargetKind = AnyChild['childType'] | 'wall';

/** The part of one target's edit `editsCommand` turns into commands. */
export type TargetEdit =
  | {
      type: 'child';
      patch: PropPatch;
      /** A floor carries the rooms anchored inside its outline through the same map. */
      carry?: { layerId: string; ring: Pt[]; map: PointMap };
    }
  | { type: 'wall'; layerId: string; wallId: string; map: PointMap }
  | { type: 'command'; build: (label: string) => Command | null };

export interface TransformTarget {
  readonly id: string;
  readonly kind: TargetKind;
  readonly layerId: string;
  /** World box, as the gizmo draws it. */
  readonly bounds: WorldBox;
  /** The target as it was taken: through `t`, or null when nothing would change. */
  edit(t: WorldTransform): TargetEdit | null;
  /** Mirrored about its own centre, or null when it has nothing to mirror. */
  flip(axis: 'h' | 'v'): TargetEdit | null;
  /** Writes `t` to the store off the undo stack: a gesture's live preview. */
  apply(t: WorldTransform): void;
  /** Puts back what `apply` wrote. */
  revert(): void;
}

const IDENTITY: WorldTransform = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0 };

/** A translation by (dx, dy). */
export function translation(dx: number, dy: number): WorldTransform {
  return { ...IDENTITY, translateX: dx, translateY: dy };
}

/** The values `obj` holds now for each key `after` writes, cloned. */
function beforeOf<T extends object>(obj: T, after: Partial<T>): Partial<T> {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(after)) before[key] = structuredClone((obj as Record<string, unknown>)[key]);
  return before as Partial<T>;
}

function boxCentre(b: WorldBox): Pt {
  return [b.x + b.width / 2, b.y + b.height / 2];
}

function findLayer(layerId: string): DungeonLayer | undefined {
  const l = useStore.getState().layers.find((x) => x.id === layerId);
  return l && l.type === 'dungeon' ? (l as DungeonLayer) : undefined;
}

// ─── Children ──────────────────────────────────────────────

/** Mirror rings about (cx, cy), order reversed so the winding survives; tangents swap in/out. */
function mirrorRings(snap: Extract<ChildSnapshot, { kind: 'rings' }>, axis: 'h' | 'v'): Partial<AnyChild> | null {
  const pts = snap.contours.flat();
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const m = mirrorMap(axis, cx, cy);
  const contours = snap.contours.map((ring) => ring.map((p) => m(p)).reverse());
  const tangents = snap.tangents?.map((rt, r) =>
    Array.from({ length: snap.contours[r]?.length ?? 0 }, (_, i) => {
      const vt = rt?.[i];
      return vt ? { ...(vt.tout ? { tin: m(vt.tout) } : {}), ...(vt.tin ? { tout: m(vt.tin) } : {}) } : null;
    }).reverse(),
  );
  return { contours, tangents } as Partial<AnyChild>;
}

function childTarget(layer: DungeonLayer, child: AnyChild): TransformTarget {
  const snap = snapshotChild(child);
  // A light by its marker: align and distribute line up the lamps, not their glow.
  const bounds = getChildFootprint(child);
  const layerId = layer.id;
  const patch = (after: Partial<AnyChild>): PropPatch => ({ layerId, id: child.id, before: beforeOf(child, after), after });
  const carryRing = (): Pt[] =>
    snap.kind === 'rings' && child.childType === 'shape' ? flattenRing(snap.contours[0] ?? [], snap.tangents?.[0]) : [];
  let applied: Partial<AnyChild> | null = null;
  return {
    id: child.id,
    kind: child.childType,
    layerId,
    bounds,
    edit(t) {
      if (snap.kind === 'none' || isIdentity(t)) return null;
      const after = transformChild(snap, t);
      if (Object.keys(after).length === 0) return null;
      const ring = carryRing();
      return {
        type: 'child',
        patch: patch(after),
        carry: ring.length >= 3 ? { layerId, ring, map: ([x, y]) => mapPoint(x, y, t) } : undefined,
      };
    },
    flip(axis) {
      if (child.childType === 'asset') {
        const key = axis === 'h' ? 'flipX' : 'flipY';
        return { type: 'child', patch: patch({ [key]: !child[key] } as Partial<AnyChild>) };
      }
      if (snap.kind !== 'rings') return null;
      const mirrored = mirrorRings(snap, axis);
      if (!mirrored) return null;
      // Only shapes carry a baked-in transform; snapshotChild folded it into the rings.
      const after = child.childType === 'shape' ? ({ ...mirrored, transform: undefined } as Partial<AnyChild>) : mirrored;
      const ring = carryRing();
      const [cx, cy] = boxCentre(bounds);
      return {
        type: 'child',
        patch: patch(after),
        carry: ring.length >= 3 ? { layerId, ring, map: mirrorMap(axis, cx, cy) } : undefined,
      };
    },
    apply(t) {
      if (snap.kind === 'none') return;
      const after = transformChild(snap, t);
      if (!applied) applied = beforeOf(child, after);
      useStore.getState().updateChild(layerId, child.id, after);
    },
    revert() {
      if (applied) useStore.getState().updateChild(layerId, child.id, applied);
      applied = null;
    },
  };
}

/**
 * A door lives on its wall: it moves only along it (a nudge's step projected onto the
 * wall's line, the doorway sealed again), never turns or resizes, and is not in the box.
 */
function doorTarget(layer: DungeonLayer, door: DoorChild): TransformTarget {
  return {
    id: door.id,
    kind: 'door',
    layerId: layer.id,
    bounds: getChildBounds(door),
    edit(t) {
      if (isIdentity(t) || Math.abs(t.rotation) > 1e-9 || Math.abs(t.scaleX - 1) > 1e-9 || Math.abs(t.scaleY - 1) > 1e-9) {
        return null;
      }
      const host = layer.standaloneWalls.find((w) => w.id === door.wallId);
      if (!host || host.points.length < 2) return null;
      const want: Pt = [door.position[0] + t.translateX, door.position[1] + t.translateY];
      let best: Pt = want;
      let bestD = Infinity;
      for (let i = 0; i < host.points.length - 1; i++) {
        const p = projectPointOntoLineSegment(want, host.points[i], host.points[i + 1]);
        if (p.distance < bestD) {
          bestD = p.distance;
          best = p.closest;
        }
      }
      const at: Pt = [best[0], best[1]];
      return {
        type: 'command',
        build: (label) => {
          const live = findLayer(layer.id);
          return live
            ? doorwayEditCommand(label, live, door.id, { position: [...door.position] }, { position: at }, { at })
            : null;
        },
      };
    },
    flip: () => null,
    apply: () => {},
    revert: () => {},
  };
}

// ─── Walls ─────────────────────────────────────────────────

function wallTarget(layer: DungeonLayer, wall: WallSegment): TransformTarget {
  const layerId = layer.id;
  const points = wall.points.map((p) => [p[0], p[1]] as Pt);
  const doors = doorsOnWall(layer, wall.id).map((d) => ({ id: d.id, position: [...d.position] as Pt, angle: d.angle }));
  const bounds = getWallBounds(wall, wallReach(wall, layer));
  const write = (map: PointMap | null) =>
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === layerId);
      if (!l || l.type !== 'dungeon') return;
      const dl = l as DungeonLayer;
      const w = dl.standaloneWalls.find((x) => x.id === wall.id);
      if (w) w.points = map ? mapWallPoints(points, map) : points.map((p) => [p[0], p[1]] as Pt);
      for (const d of doors) {
        const c = dl.children.find((x) => x.id === d.id) as DoorChild | undefined;
        if (!c) continue;
        const pose = map ? mapDoorPose(d, map) : { position: [d.position[0], d.position[1]] as Pt, angle: d.angle };
        c.position = pose.position;
        c.angle = pose.angle;
      }
    });
  let applied = false;
  return {
    id: wall.id,
    kind: 'wall',
    layerId,
    bounds,
    edit(t) {
      if (isIdentity(t)) return null;
      return { type: 'wall', layerId, wallId: wall.id, map: ([x, y]) => mapPoint(x, y, t) };
    },
    flip(axis) {
      const [cx, cy] = wallCentre(points);
      return { type: 'wall', layerId, wallId: wall.id, map: mirrorMap(axis, cx, cy) };
    },
    apply(t) {
      applied = true;
      write(([x, y]) => mapPoint(x, y, t));
    },
    revert() {
      if (applied) write(null);
      applied = false;
    },
  };
}

// ─── Building targets ──────────────────────────────────────

export interface TargetSet {
  targets: TransformTarget[];
  /** Selected members left out because they are locked. */
  locked: string[];
}

/**
 * The transform targets for `ids`: every child and drawn wall in the selection, never a
 * room. Locked members are left out (and counted). A door whose wall is in the selection
 * rides with the wall instead of moving on its own.
 */
export function buildTargets(state: { layers: readonly Layer[] }, ids: readonly string[]): TargetSet {
  const sel = resolveSelection(state, ids);
  const wallIds = new Set(sel.walls.filter((w) => !isLockedObject(w.wall)).map((w) => w.wall.id));
  const targets: TransformTarget[] = [];
  for (const { child, layer } of sel.children) {
    if (isLockedObject(child)) continue;
    if (child.childType === 'door') {
      if (!wallIds.has(child.wallId)) targets.push(doorTarget(layer, child));
      continue;
    }
    targets.push(childTarget(layer, child));
  }
  for (const { wall, layer } of sel.walls) {
    if (isLockedObject(wall)) continue;
    targets.push(wallTarget(layer, wall));
  }
  return { targets, locked: sel.locked };
}

/** The targets the gizmo boxes: everything but doors (they slide only along their wall). */
export function boxTargets(targets: readonly TransformTarget[]): TransformTarget[] {
  return targets.filter((t) => t.kind !== 'door');
}

/** The union of the targets' boxes, or null for none. */
export function unionTargetBounds(targets: readonly TransformTarget[]): WorldBox | null {
  if (targets.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { bounds: b } of targets) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ─── Edits to commands ─────────────────────────────────────

/**
 * The commands for a batch of wall moves: per layer, every moved wall's new line, the
 * doors on them carried along, and every doorway they sit in sealed again.
 */
export function wallMoveCommands(
  label: string,
  moves: readonly { layerId: string; wallId: string; map: PointMap }[],
): Command[] {
  const byLayer = new Map<string, Map<string, PointMap>>();
  for (const m of moves) {
    const forLayer = byLayer.get(m.layerId) ?? new Map<string, PointMap>();
    forLayer.set(m.wallId, m.map);
    byLayer.set(m.layerId, forLayer);
  }
  const cmds: Command[] = [];
  for (const [layerId, forLayer] of byLayer) {
    const layer = findLayer(layerId);
    if (!layer) continue;
    const plan = planWallEdits(layer, forLayer);
    for (const w of plan.walls) cmds.push(new UpdateWallCommand(layerId, w.id, { points: w.before }, { points: w.after }));
    for (const d of plan.doors) {
      cmds.push(new UpdateChildCommand(label, layerId, d.id, d.before as Partial<AnyChild>, d.after as Partial<AnyChild>));
    }
  }
  return cmds;
}

/** The rooms anchored inside each moved floor's outline, carried through its map. */
export function roomCarryCommands(carries: readonly { layerId: string; ring: Pt[]; map: PointMap }[]): Command[] {
  const cmds: Command[] = [];
  const carried = new Set<string>();
  for (const c of carries) {
    for (const room of findLayer(c.layerId)?.rooms ?? []) {
      if (carried.has(room.id) || !pointInRing(room.anchor[0], room.anchor[1], c.ring)) continue;
      carried.add(room.id);
      cmds.push(new SetRoomAnchorCommand(c.layerId, room.id, c.map(room.anchor)));
    }
  }
  return cmds;
}

/**
 * One undo entry for a batch of target edits: every child patch through the prop patch
 * (it carries the lights attached to a moved prop), every wall move per layer with its
 * doors re-sealed, the rooms anchored inside a moved floor carried along, and anything a
 * target built itself (a door sliding on its wall). Null when nothing changes.
 */
export function editsCommand(label: string, edits: readonly (TargetEdit | null)[]): Command | null {
  const live = edits.filter((e): e is TargetEdit => e !== null);
  if (live.length === 0) return null;
  const cmds: Command[] = [];
  const patches = live.flatMap((e) => (e.type === 'child' ? [e.patch] : []));
  if (patches.length > 0) cmds.push(createPropPatchCommand(label, patches));
  cmds.push(...wallMoveCommands(label, live.flatMap((e) => (e.type === 'wall' ? [e] : []))));
  cmds.push(...roomCarryCommands(live.flatMap((e) => (e.type === 'child' && e.carry ? [e.carry] : []))));
  for (const e of live) {
    if (e.type !== 'command') continue;
    const c = e.build(label);
    if (c) cmds.push(c);
  }
  if (cmds.length === 0) return null;
  return cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds);
}

/** Every target through `t`, one entry. */
export function transformCommand(label: string, targets: readonly TransformTarget[], t: WorldTransform): Command | null {
  return editsCommand(label, targets.map((x) => x.edit(t)));
}

/** Every target mirrored about its own centre, one entry. */
export function flipCommand(targets: readonly TransformTarget[], axis: 'h' | 'v'): Command | null {
  return editsCommand(axis === 'h' ? 'Flip horizontal' : 'Flip vertical', targets.map((x) => x.flip(axis)));
}

/** Every target a quarter turn clockwise about its own centre (lights have no turn). */
export function rotate90Command(targets: readonly TransformTarget[]): Command | null {
  return editsCommand(
    'Rotate 90°',
    targets.map((x) => {
      if (x.kind === 'light' || x.kind === 'door') return null;
      const [cx, cy] = boxCentre(x.bounds);
      return x.edit({ ...IDENTITY, rotation: Math.PI / 2, anchorX: cx, anchorY: cy });
    }),
  );
}

// ─── Nudge ─────────────────────────────────────────────────

/** How long a run of nudges on one selection keeps folding into one undo entry, ms. */
export const NUDGE_COALESCE_MS = 600;

/**
 * An arrow-key nudge. A run of them on the same selection, each within the coalescing
 * window of the last, folds into one undo entry: the entry adopts every later step.
 */
export class NudgeCommand implements Command {
  readonly label = 'Nudge';
  readonly coalesceKey: string;
  private parts: Command[];

  constructor(ids: readonly string[], inner: Command) {
    this.coalesceKey = `nudge:${[...ids].sort().join(',')}`;
    this.parts = [inner];
  }

  get affectsRooms(): boolean {
    return this.parts.some((p) => p.affectsRooms);
  }

  /** How many steps this entry holds. */
  get steps(): number {
    return this.parts.length;
  }

  execute(): void {
    for (const p of this.parts) p.execute();
  }

  undo(): void {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i].undo();
  }

  merge(next: Command): boolean {
    if (!(next instanceof NudgeCommand) || next.coalesceKey !== this.coalesceKey) return false;
    this.parts.push(...next.parts);
    return true;
  }
}

/** The nudge of the selection `ids` by (dx, dy) squares, or null when nothing moves. */
export function createNudgeCommand(
  state: { layers: readonly Layer[] },
  ids: readonly string[],
  dx: number,
  dy: number,
): { command: NudgeCommand | null; locked: number } {
  const { targets, locked } = buildTargets(state, ids);
  const inner = transformCommand('Nudge', targets, translation(dx, dy));
  return { command: inner ? new NudgeCommand(ids, inner) : null, locked: locked.length };
}

// ─── Align and distribute ──────────────────────────────────

const ALIGN_LABELS: Record<AlignEdge, string> = {
  left: 'Align left',
  hcenter: 'Align centres',
  right: 'Align right',
  top: 'Align top',
  vcenter: 'Align middles',
  bottom: 'Align bottom',
};

/** The targets align and distribute move: anything with a box but a door. */
function arrangeable(targets: readonly TransformTarget[]): TransformTarget[] {
  return targets.filter((t) => t.kind !== 'door');
}

/** Moves each target's box to the edge (or centre line) of the union box. Needs two. */
export function alignTargetsCommand(targets: readonly TransformTarget[], edge: AlignEdge): Command | null {
  const items = arrangeable(targets);
  if (items.length < 2) return null;
  const u = unionTargetBounds(items)!;
  return editsCommand(
    ALIGN_LABELS[edge],
    items.map((it) => {
      const b = it.bounds;
      let dx = 0;
      let dy = 0;
      if (edge === 'left') dx = u.x - b.x;
      else if (edge === 'right') dx = u.x + u.width - (b.x + b.width);
      else if (edge === 'hcenter') dx = u.x + u.width / 2 - (b.x + b.width / 2);
      else if (edge === 'top') dy = u.y - b.y;
      else if (edge === 'bottom') dy = u.y + u.height - (b.y + b.height);
      else dy = u.y + u.height / 2 - (b.y + b.height / 2);
      return Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 ? null : it.edit(translation(dx, dy));
    }),
  );
}

/** Spaces three or more targets evenly along `axis`; the two ends stay put. */
export function distributeTargetsCommand(targets: readonly TransformTarget[], axis: 'h' | 'v'): Command | null {
  const h = axis === 'h';
  const items = arrangeable(targets)
    .map((t) => ({ t, min: h ? t.bounds.x : t.bounds.y, size: h ? t.bounds.width : t.bounds.height }))
    .sort((a, b) => a.min + a.size / 2 - (b.min + b.size / 2));
  if (items.length < 3) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const total = items.reduce((s, it) => s + it.size, 0);
  const gap = (last.min + last.size - first.min - total) / (items.length - 1);
  let cursor = first.min;
  const edits: (TargetEdit | null)[] = [];
  for (const it of items) {
    const d = cursor - it.min;
    cursor += it.size + gap;
    if (Math.abs(d) < 1e-9) continue;
    edits.push(it.t.edit(h ? translation(d, 0) : translation(0, d)));
  }
  return editsCommand(h ? 'Distribute horizontally' : 'Distribute vertically', edits);
}
