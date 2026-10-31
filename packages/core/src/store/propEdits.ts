// Every prop edit as one Command. Callers run `undoManager.execute()` on the result.
//
// Two rules hold for the whole file. Everything that moves, turns, flips or resizes a
// prop goes through `createPropPatchCommand`, which carries the lights attached to it.
// Every copy goes through `createDuplicateCommand`. Props never change room faces, so
// nothing here sets `affectsRooms`.

import type { AnyChild, AssetChild, LightChild, RingGeometry } from '../shared/types';
import { isEditableProp, type PropFieldKey } from '../shared/propFields';
import { translateTangents } from '../shared/bezier';
import type { ChildGroupInfo, Command, DungeonLayer, Layer } from './types';
import { useStore } from './store';
import { selectWallById } from './selectors';
import {
  AddChildCommand,
  AddWallCommand,
  ChildGroupsCommand,
  ChildOrderCommand,
  CompositeCommand,
  RemoveChildCommand,
  RemoveWallCommand,
  UpdateChildCommand,
} from './commands';
import { followAsset, followCommands, lightsOn } from './attachedLights';
import { familyKeyOf, getCatalogEntry, GRID_CELL_PX, nextAssetName, siblingOf } from '../assets/packCatalog';
import {
  effectiveContours,
  mapPoint,
  snapshotChild,
  transformChild,
  type WorldTransform,
} from '../engine/tools/childTransform';
import { localScaleFor } from '../engine/tools/transformMath';

/** A box by its centre and size, world units (cells). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ZOrderOp = 'front' | 'back' | 'forward' | 'backward';
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** One child's edit. `before` holds the current values of every key `after` writes. */
export interface PropPatch {
  layerId: string;
  id: string;
  before: Partial<AnyChild>;
  after: Partial<AnyChild>;
}

export interface DuplicateOptions {
  /** Added to every copy. Default one square right and down, unless `centreAt` is given. */
  offset?: { x: number; y: number };
  /** Centre the copies on this point instead (Paste here). */
  centreAt?: { x: number; y: number };
  /** Copy into this layer; default each child's own layer. */
  targetLayerId?: string;
  /** Copy these snapshots (the clipboard) instead of looking `ids` up in `layers`. */
  children?: AnyChild[];
  label?: string;
}

// ─── Lookups ─────────────────────────────────────────────

interface Found<C extends AnyChild = AnyChild> {
  layer: DungeonLayer;
  child: C;
}

function dungeonLayers(layers: readonly Layer[]): DungeonLayer[] {
  return layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
}

function findChild(layers: readonly Layer[], id: string): Found | null {
  for (const layer of dungeonLayers(layers)) {
    const child = layer.children.find((c) => c.id === id);
    if (child) return { layer, child };
  }
  return null;
}

function findChildren(layers: readonly Layer[], ids: readonly string[]): Found[] {
  return [...new Set(ids)].map((id) => findChild(layers, id)).filter((f): f is Found => f !== null);
}

/** The selected props a canvas edit may change: assets and images, never locked ones. */
function editableProps(ids: readonly string[]): Found<AssetChild>[] {
  return findChildren(useStore.getState().layers, ids).filter((f): f is Found<AssetChild> =>
    isEditableProp(f.child),
  );
}

/** The values `child` holds now for each key `after` writes. */
function beforeOf(child: AnyChild, after: Partial<AnyChild>): Partial<AnyChild> {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(after)) before[key] = (child as unknown as Record<string, unknown>)[key];
  return before as Partial<AnyChild>;
}

function one(label: string, cmds: Command[]): Command {
  return cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds);
}

/** A prop's drawn size: `width × scale` by `height × scale` (legacy `scale` folded in). */
function drawnSize(c: AssetChild): { w: number; h: number } {
  return { w: c.width * c.scale, h: c.height * c.scale };
}

interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The world box around a prop's turned footprint. */
function aabbOf(c: AssetChild): Aabb {
  const { w, h } = drawnSize(c);
  const cos = Math.abs(Math.cos(c.rotation));
  const sin = Math.abs(Math.sin(c.rotation));
  const hw = (w * cos + h * sin) / 2;
  const hh = (w * sin + h * cos) / 2;
  return { minX: c.position.x - hw, minY: c.position.y - hh, maxX: c.position.x + hw, maxY: c.position.y + hh };
}

/** An entry's natural size in cells. */
function naturalCells(assetId: string): { w: number; h: number } | null {
  const e = getCatalogEntry(assetId);
  return e ? { w: e.naturalWidth / GRID_CELL_PX, h: e.naturalHeight / GRID_CELL_PX } : null;
}

// ─── Place ───────────────────────────────────────────────

/**
 * New props on a layer: on top (appended), or `under` the layer's existing props
 * (inserted, in order, where its first asset child sits).
 */
export function createPlacePropsCommand(
  layerId: string,
  children: AssetChild[],
  opts: { under: boolean; label?: string },
): Command {
  const label = opts.label ?? (children.length === 1 ? 'Place prop' : 'Place props');
  const layer = dungeonLayers(useStore.getState().layers).find((l) => l.id === layerId);
  const at = opts.under && layer ? layer.children.findIndex((c) => c.childType === 'asset') : -1;
  return one(
    label,
    children.map((c, k) => new AddChildCommand(label, layerId, c, at >= 0 ? at + k : undefined)),
  );
}

// ─── The one patch path ──────────────────────────────────

/**
 * The edit every prop move, turn, flip, resize and swap goes through: one
 * `UpdateChildCommand` per patch plus the moves of every light attached to a patched
 * asset (on any layer). A light patched in its own right is left to its own patch.
 *
 * Build it while the store holds the `before` state of the lights: the assets' own
 * before is read from the patches, so a live preview may still be showing on them.
 */
export function createPropPatchCommand(label: string, patches: PropPatch[]): Command {
  const layers = useStore.getState().layers;
  const cmds: Command[] = patches.map((p) => new UpdateChildCommand(label, p.layerId, p.id, p.before, p.after));
  const before = new Map<string, AssetChild>();
  const after = new Map<string, AssetChild>();
  for (const p of patches) {
    const child = dungeonLayers(layers)
      .find((l) => l.id === p.layerId)
      ?.children.find((c) => c.id === p.id);
    if (child?.childType !== 'asset') continue;
    const b = { ...child, ...p.before } as AssetChild;
    before.set(p.id, b);
    after.set(p.id, { ...b, ...p.after } as AssetChild);
  }
  cmds.push(...followCommands(layers, before, after, new Set(patches.map((p) => p.id)), label));
  return one(label, cmds);
}

// ─── Fields ──────────────────────────────────────────────

/**
 * Tint, opacity, overhead, lock and the behaviour fields on every prop in `ids`
 * (locked ones too: this is how a prop is unlocked). Null when none is a prop.
 */
export function createSetPropFieldsCommand(
  ids: string[],
  patch: Partial<Pick<AssetChild, PropFieldKey | 'tint' | 'glow'>>,
): Command | null {
  const props = findChildren(useStore.getState().layers, ids).filter(
    (f): f is Found<AssetChild> => f.child.childType === 'asset',
  );
  if (props.length === 0 || Object.keys(patch).length === 0) return null;
  const label = patch.locked === true ? 'Lock' : patch.locked === false ? 'Unlock' : 'Edit prop';
  return createPropPatchCommand(
    label,
    props.map(({ layer, child }) => ({ layerId: layer.id, id: child.id, before: beforeOf(child, patch), after: patch })),
  );
}

// ─── Box: numeric fields and the gizmo commit ────────────

/**
 * Puts the selection's box `from` onto `to`. A single prop's box is its own oriented
 * box (centre, drawn size, `angle` = its rotation): `to` is written straight onto it.
 * Several children share one world box: each centre is mapped through the box change,
 * each prop's size scaled on its own axes (`localScaleFor`), and `to.angle - from.angle`
 * turns everything about the box centre. Sizes are written to `width`/`height` with
 * `scale: 1`. Locked props are left alone.
 */
export function createPropBoxCommand(
  ids: string[],
  from: Box & { angle?: number },
  to: Box & { angle?: number },
): Command | null {
  const found = findChildren(useStore.getState().layers, ids).filter(
    (f) => f.child.childType !== 'asset' || isEditableProp(f.child),
  );
  if (found.length === 0) return null;
  const patches: PropPatch[] = [];

  if (found.length === 1 && found[0].child.childType === 'asset') {
    const { layer, child } = found[0] as Found<AssetChild>;
    const after: Partial<AssetChild> = {
      position: { x: to.x, y: to.y },
      width: Math.max(to.w, 0.01),
      height: Math.max(to.h, 0.01),
      scale: 1,
      rotation: to.angle ?? child.rotation,
    };
    patches.push({ layerId: layer.id, id: child.id, before: beforeOf(child, after), after });
  } else {
    const sx = from.w > 1e-9 ? to.w / from.w : 1;
    const sy = from.h > 1e-9 ? to.h / from.h : 1;
    const turn = (to.angle ?? from.angle ?? 0) - (from.angle ?? 0);
    const t: WorldTransform = {
      translateX: to.x - from.x,
      translateY: to.y - from.y,
      scaleX: sx,
      scaleY: sy,
      rotation: turn,
      anchorX: from.x,
      anchorY: from.y,
    };
    for (const { layer, child } of found) {
      let after: Partial<AnyChild>;
      if (child.childType === 'asset') {
        const [x, y] = mapPoint(child.position.x, child.position.y, t);
        const { su, sv } = localScaleFor(child.rotation, sx, sy);
        const { w, h } = drawnSize(child);
        after = {
          position: { x, y },
          width: Math.max(w * su, 0.01),
          height: Math.max(h * sv, 0.01),
          scale: 1,
          rotation: child.rotation + turn,
        } as Partial<AssetChild>;
      } else {
        after = transformChild(snapshotChild(child), t);
      }
      if (Object.keys(after).length === 0) continue;
      patches.push({ layerId: layer.id, id: child.id, before: beforeOf(child, after), after });
    }
  }
  if (patches.length === 0) return null;
  return createPropPatchCommand(patches.length === 1 ? 'Transform object' : 'Transform objects', patches);
}

// ─── Z-order ─────────────────────────────────────────────

/**
 * The layer's child ids after `op` on `ids` (array order is z-order: later on top).
 * Front and back move the selection, in its own order, to the top or the bottom.
 * Forward and backward lift each selected child past the nearest unselected child of
 * its own kind (a prop past a prop, not past a light it would not visibly cross), so
 * a selected run moves as one and a scattered selection each moves one step.
 */
export function zOrder(layer: DungeonLayer, ids: string[], op: ZOrderOp): string[] {
  const sel = new Set(ids);
  const order = layer.children.slice();
  if (op === 'front') return [...order.filter((c) => !sel.has(c.id)), ...order.filter((c) => sel.has(c.id))].map((c) => c.id);
  if (op === 'back') return [...order.filter((c) => sel.has(c.id)), ...order.filter((c) => !sel.has(c.id))].map((c) => c.id);

  const up = op === 'forward';
  const moving = order.filter((c) => sel.has(c.id));
  if (up) moving.reverse();
  for (const child of moving) {
    const i = order.indexOf(child);
    let j = i;
    for (let k = up ? i + 1 : i - 1; k >= 0 && k < order.length; k += up ? 1 : -1) {
      if (!sel.has(order[k].id) && order[k].childType === child.childType) {
        j = k;
        break;
      }
    }
    if (j === i) continue;
    order.splice(i, 1);
    order.splice(j, 0, child);
  }
  return order.map((c) => c.id);
}

const Z_LABELS: Record<ZOrderOp, string> = {
  front: 'Bring to front',
  back: 'Send to back',
  forward: 'Bring forward',
  backward: 'Send backward',
};

/** `zOrder` on every layer the selection touches, one undo entry. Null when nothing moves. */
export function createZOrderCommand(ids: string[], op: ZOrderOp): Command | null {
  const found = findChildren(useStore.getState().layers, ids);
  const cmds: Command[] = [];
  for (const layer of new Set(found.map((f) => f.layer))) {
    const before = layer.children.map((c) => c.id);
    const order = zOrder(layer, ids, op);
    if (order.every((id, i) => id === before[i])) continue;
    cmds.push(new ChildOrderCommand(Z_LABELS[op], layer.id, order));
  }
  return cmds.length === 0 ? null : one(Z_LABELS[op], cmds);
}

// ─── Align and distribute ────────────────────────────────

const ALIGN_LABELS: Record<AlignEdge, string> = {
  left: 'Align left',
  hcenter: 'Align centres',
  right: 'Align right',
  top: 'Align top',
  vcenter: 'Align middles',
  bottom: 'Align bottom',
};

/** Moves each prop's turned box to the edge (or centre line) of the selection's union box. */
export function createAlignCommand(ids: string[], edge: AlignEdge): Command | null {
  const props = editableProps(ids);
  if (props.length < 2) return null;
  const boxes = props.map((f) => aabbOf(f.child));
  const u: Aabb = {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
  const patches: PropPatch[] = [];
  props.forEach(({ layer, child }, i) => {
    const b = boxes[i];
    let dx = 0;
    let dy = 0;
    if (edge === 'left') dx = u.minX - b.minX;
    else if (edge === 'right') dx = u.maxX - b.maxX;
    else if (edge === 'hcenter') dx = (u.minX + u.maxX) / 2 - (b.minX + b.maxX) / 2;
    else if (edge === 'top') dy = u.minY - b.minY;
    else if (edge === 'bottom') dy = u.maxY - b.maxY;
    else dy = (u.minY + u.maxY) / 2 - (b.minY + b.maxY) / 2;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
    const after = { position: { x: child.position.x + dx, y: child.position.y + dy } };
    patches.push({ layerId: layer.id, id: child.id, before: { position: child.position }, after });
  });
  return patches.length === 0 ? null : createPropPatchCommand(ALIGN_LABELS[edge], patches);
}

/**
 * Spaces three or more props evenly along `axis`: sorted by centre, the two ends stay
 * put and the gaps between their turned boxes come out equal. Null under three.
 */
export function createDistributeCommand(ids: string[], axis: 'h' | 'v'): Command | null {
  const props = editableProps(ids);
  if (props.length < 3) return null;
  const h = axis === 'h';
  const items = props
    .map((f) => {
      const b = aabbOf(f.child);
      return { ...f, min: h ? b.minX : b.minY, size: h ? b.maxX - b.minX : b.maxY - b.minY };
    })
    .sort((a, b) => a.min + a.size / 2 - (b.min + b.size / 2));
  const first = items[0];
  const last = items[items.length - 1];
  const total = items.reduce((s, it) => s + it.size, 0);
  const gap = (last.min + last.size - first.min - total) / (items.length - 1);
  const patches: PropPatch[] = [];
  let cursor = first.min;
  for (const it of items) {
    const d = cursor - it.min;
    cursor += it.size + gap;
    if (Math.abs(d) < 1e-9) continue;
    const p = it.child.position;
    const after = { position: h ? { x: p.x + d, y: p.y } : { x: p.x, y: p.y + d } };
    patches.push({ layerId: it.layer.id, id: it.child.id, before: { position: p }, after });
  }
  return patches.length === 0 ? null : createPropPatchCommand(h ? 'Distribute horizontally' : 'Distribute vertically', patches);
}

// ─── Swap ────────────────────────────────────────────────

/**
 * Swaps each prop's art for `target` (an asset id) or the sibling `step` away in its
 * family, keeping centre, rotation, flips, tint and every field.
 *
 * 'footprint' keeps the box: a sibling of the same grid size takes the old size as is;
 * any other art is fitted inside the old box at its own aspect. 'natural' (a library
 * pick) draws the new art at its natural size times the old prop's size factor.
 */
export function createSwapPropCommand(
  ids: string[],
  target: string | { step: 1 | -1 },
  fit: 'footprint' | 'natural',
): Command | null {
  const patches: PropPatch[] = [];
  // Names a layer already holds, so several props renamed in one swap never share one.
  const taken = new Map<string, string[]>();
  for (const { layer, child } of editableProps(ids)) {
    const nextId = typeof target === 'string' ? target : siblingOf(child.assetId, target.step);
    if (nextId === child.assetId) continue;
    const next = getCatalogEntry(nextId);
    const nat = naturalCells(nextId);
    if (!next || !nat) continue;
    const old = child.objectType === 'asset' ? getCatalogEntry(child.assetId) : undefined;
    const { w: W, h: H } = drawnSize(child);
    let w: number;
    let h: number;
    if (fit === 'footprint') {
      if (old?.gridSize === next.gridSize) {
        w = W;
        h = H;
      } else if (W / H > nat.w / nat.h) {
        h = H;
        w = (H * nat.w) / nat.h;
      } else {
        w = W;
        h = (W * nat.h) / nat.w;
      }
    } else {
      const oldNat = old ? naturalCells(old.id) : null;
      const factor = oldNat && oldNat.w > 0 ? W / oldNat.w : 1;
      w = nat.w * factor;
      h = nat.h * factor;
    }
    const after: Partial<AssetChild> = { assetId: nextId, objectType: 'asset', width: w, height: h, scale: 1 };
    // Another family is another thing: it takes the name a placement of it would get. A
    // variant of the same family keeps the name the DM knows it by.
    if (child.objectType !== 'asset' || familyKeyOf(child.assetId) !== familyKeyOf(nextId)) {
      const names = taken.get(layer.id) ?? layer.children.filter((c) => c.id !== child.id).map((c) => c.name);
      after.name = nextAssetName(nextId, names);
      taken.set(layer.id, [...names, after.name]);
    }
    patches.push({ layerId: layer.id, id: child.id, before: beforeOf(child, after), after });
  }
  if (patches.length === 0) return null;
  return createPropPatchCommand(fit === 'natural' ? 'Replace prop' : 'Swap prop', patches);
}

// ─── The one duplicate path ──────────────────────────────

function childCentre(c: AnyChild): { x: number; y: number } | null {
  if ('position' in c) return Array.isArray(c.position) ? { x: c.position[0], y: c.position[1] } : c.position;
  if (c.childType === 'zone') {
    const s = c.shape;
    return s.kind === 'rect' ? { x: s.x + s.width / 2, y: s.y + s.height / 2 } : s.position;
  }
  const pts = effectiveContours(c as RingGeometry)[0] ?? [];
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Slides a copy by (dx, dy), whatever its kind keeps its place in. */
function translateChild(c: AnyChild, dx: number, dy: number): void {
  if ('position' in c) {
    if (Array.isArray(c.position)) c.position = [c.position[0] + dx, c.position[1] + dy];
    else c.position = { x: c.position.x + dx, y: c.position.y + dy };
  } else if (c.childType === 'zone') {
    c.shape =
      c.shape.kind === 'rect'
        ? { ...c.shape, x: c.shape.x + dx, y: c.shape.y + dy }
        : { ...c.shape, position: { x: c.shape.position.x + dx, y: c.shape.position.y + dy } };
  } else if (c.childType === 'shape' && c.transform) {
    c.transform.translate = [c.transform.translate[0] + dx, c.transform.translate[1] + dy];
  } else {
    c.contours = c.contours.map((ring) => ring.map(([x, y]): [number, number] => [x + dx, y + dy]));
    c.tangents = translateTangents(c.tangents, dx, dy);
  }
}

/**
 * Copies children as one undo entry: Ctrl+D, Ctrl+V, Paste here, the panel's
 * Duplicate and Duplicate group all come through here.
 *
 * - Copies get fresh ids, " (copy)" names, and land `offset` away (default 1, 1) or
 *   centred on `centreAt`, in `targetLayerId` or their own layer.
 * - A whole group copied gets a new group record (" (copy)", same merged flag) on the
 *   target layer. Part of a group stays in that group on its own layer and leaves it
 *   anywhere else, so no copy points at a group its layer does not have.
 * - Lights attached to a copied asset are copied too, glued to the copy at the same
 *   spot on it. A light copied with its asset is re-glued to the copy; one copied
 *   without it is free-standing.
 *
 * `newIds` lists the copies of `ids` (or `children`) in order, for the selection.
 */
export function createDuplicateCommand(
  layers: readonly Layer[],
  ids: string[],
  opts: DuplicateOptions = {},
): { command: Command | null; newIds: string[] } {
  const label = opts.label ?? 'Duplicate';
  const all = dungeonLayers(layers);
  const layerById = new Map(all.map((l) => [l.id, l]));
  const homeOf = (id: string): DungeonLayer | undefined => findChild(layers, id)?.layer;

  const sources = (opts.children ?? findChildren(layers, ids).map((f) => f.child))
    .map((child) => ({ child, home: homeOf(child.id), target: opts.targetLayerId ?? homeOf(child.id)?.id }))
    .filter((s): s is { child: AnyChild; home: DungeonLayer | undefined; target: string } =>
      !!s.target && layerById.has(s.target),
    );
  if (sources.length === 0) return { command: null, newIds: [] };

  let dx = opts.offset?.x ?? 1;
  let dy = opts.offset?.y ?? 1;
  if (opts.centreAt) {
    const centres = sources.map((s) => childCentre(s.child)).filter((p): p is { x: number; y: number } => !!p);
    if (centres.length > 0) {
      dx = opts.centreAt.x - centres.reduce((s, p) => s + p.x, 0) / centres.length;
      dy = opts.centreAt.y - centres.reduce((s, p) => s + p.y, 0) / centres.length;
    }
  }

  const sourceIds = new Set(sources.map((s) => s.child.id));
  const newId = new Map<string, string>();
  for (const s of sources) newId.set(s.child.id, crypto.randomUUID());

  // Group records, per (group, target layer): a whole group copied gets a new one.
  const newGroups = new Map<string, ChildGroupInfo[]>();
  const groupCopies = new Map<string, string>();
  const groupFor = (child: AnyChild, target: string): string | undefined => {
    const gid = child.groupId;
    if (!gid) return undefined;
    const owner = all.find((l) => l.groups?.some((g) => g.id === gid));
    const info = owner?.groups?.find((g) => g.id === gid);
    if (!owner || !info) return undefined;
    const whole = owner.children.every((c) => c.groupId !== gid || sourceIds.has(c.id));
    if (!whole) return owner.id === target ? gid : undefined;
    const key = `${gid}|${target}`;
    let copy = groupCopies.get(key);
    if (!copy) {
      copy = crypto.randomUUID();
      groupCopies.set(key, copy);
      const record: ChildGroupInfo = { id: copy, name: `${info.name} (copy)` };
      if (info.merged !== undefined) record.merged = info.merged;
      newGroups.set(target, [...(newGroups.get(target) ?? []), record]);
    }
    return copy;
  };

  const copyOf = (child: AnyChild, id: string, target: string): AnyChild => {
    const copy = structuredClone(child);
    copy.id = id;
    copy.name = `${child.name} (copy)`;
    // A copy of something locked comes out unlocked: it is a new thing to place.
    delete copy.locked;
    const gid = groupFor(child, target);
    if (gid) copy.groupId = gid;
    else delete copy.groupId;
    return copy;
  };

  const adds: { target: string; child: AnyChild }[] = [];
  const copiedAssets = new Map<string, AssetChild>();
  for (const s of sources) {
    const copy = copyOf(s.child, newId.get(s.child.id)!, s.target);
    translateChild(copy, dx, dy);
    if (copy.childType === 'light' && copy.attachedTo) {
      const host = newId.get(copy.attachedTo);
      if (host) copy.attachedTo = host;
      else delete copy.attachedTo;
    }
    if (copy.childType === 'asset') copiedAssets.set(s.child.id, copy);
    adds.push({ target: s.target, child: copy });
  }

  // Lights glued to a copied asset that were not copied themselves come along.
  for (const { layerId, light } of lightsOn(layers, copiedAssets.keys())) {
    if (sourceIds.has(light.id)) continue;
    const host = findChild(layers, light.attachedTo!)?.child;
    const hostCopy = copiedAssets.get(light.attachedTo!)!;
    if (host?.childType !== 'asset') continue;
    const target = opts.targetLayerId ?? layerId;
    const copy = copyOf(light, crypto.randomUUID(), target) as LightChild;
    copy.attachedTo = hostCopy.id;
    copy.position = followAsset(host, hostCopy, light.position);
    adds.push({ target, child: copy });
  }

  const cmds: Command[] = [];
  for (const [target, records] of newGroups) {
    const groups = layerById.get(target)!.groups;
    cmds.push(new ChildGroupsCommand(label, target, { groups }, { groups: [...(groups ?? []), ...records] }));
  }
  for (const a of adds) cmds.push(new AddChildCommand(label, a.target, a.child));
  return { command: one(label, cmds), newIds: sources.map((s) => newId.get(s.child.id)!) };
}

// ─── Move to layer ───────────────────────────────────────

/**
 * Moves the selection to another dungeon layer as one undo entry. A drawn wall takes
 * the doors bound to it along; children land on top of the target in their relative
 * order; lights attached to a moved asset come along. A group moved whole keeps its
 * id and its record moves with it; a child leaving part of a group leaves the group.
 */
export function createMoveToLayerCommand(ids: string[], targetLayerId: string): Command | null {
  const state = useStore.getState();
  const all = dungeonLayers(state.layers);
  const target = all.find((l) => l.id === targetLayerId);
  if (!target) return null;
  const label = 'Move to layer';

  const wallCmds: Command[] = [];
  const moving = new Set<string>();
  for (const id of ids) {
    const found = selectWallById(state, id);
    if (found) {
      if (found.layer.id === targetLayerId) continue;
      wallCmds.push(new RemoveWallCommand(found.layer.id, id));
      wallCmds.push(new AddWallCommand(label, targetLayerId, structuredClone(found.wall)));
      // Doors riding with a moved wall move once, with it.
      for (const c of found.layer.children) if (c.childType === 'door' && c.wallId === id) moving.add(c.id);
      continue;
    }
    const f = findChild(state.layers, id);
    if (f && f.layer.id !== targetLayerId) moving.add(id);
  }
  for (const { layerId, light } of lightsOn(state.layers, moving)) {
    if (layerId !== targetLayerId) moving.add(light.id);
  }
  if (moving.size === 0 && wallCmds.length === 0) return null;

  // Layer order, then each layer's own order: the moved set keeps its stacking.
  const movers: Found[] = [];
  for (const layer of all) {
    if (layer.id === targetLayerId) continue;
    for (const child of layer.children) if (moving.has(child.id)) movers.push({ layer, child });
  }

  const sourceGroups = new Map<string, ChildGroupInfo[] | undefined>();
  const carried: ChildGroupInfo[] = [];
  const keepsGroup = new Set<string>();
  for (const layer of new Set(movers.map((m) => m.layer))) {
    let groups = layer.groups;
    for (const g of layer.groups ?? []) {
      const members = layer.children.filter((c) => c.groupId === g.id);
      if (members.length === 0 || !members.every((c) => moving.has(c.id))) continue;
      keepsGroup.add(g.id);
      carried.push(g);
      groups = groups?.filter((x) => x.id !== g.id);
    }
    if (groups !== layer.groups) sourceGroups.set(layer.id, groups?.length ? groups : undefined);
  }

  const cmds: Command[] = movers.map((m) => new RemoveChildCommand(label, m.layer.id, m.child.id));
  for (const [layerId, groups] of sourceGroups) {
    const layer = all.find((l) => l.id === layerId)!;
    cmds.push(new ChildGroupsCommand(label, layerId, { groups: layer.groups }, { groups }));
  }
  if (carried.length > 0) {
    cmds.push(
      new ChildGroupsCommand(label, targetLayerId, { groups: target.groups }, { groups: [...(target.groups ?? []), ...carried] }),
    );
  }
  cmds.push(...wallCmds);
  for (const { child } of movers) {
    const copy = structuredClone(child);
    if (copy.groupId && !keepsGroup.has(copy.groupId)) delete copy.groupId;
    cmds.push(new AddChildCommand(label, targetLayerId, copy));
  }
  return new CompositeCommand(label, cmds);
}
