// Attached objects: props a kit places along a path or a plot (a plateau's cliff), as
// Canvas of Kings does: trees along a road's verge, reeds on a shore and lily pads on the
// water, rubble out past a cliff's foot. They are real props (AssetChild with `attachedTo`),
// laid by the same edge walk as a kit's units (pathKitLayout `edgeWalk`), seeded by the host's
// id, kept clear of every edge unit, foot unit and other prop on the layer, and laid again
// whenever the host is drawn or edited. Moving the host moves them, deleting it removes them,
// and Detach turns them into plain props that stay where they are.
//
// `layAttached` is the pure layout; `createAttachedSync` is the bookkeeping that decides when
// to lay (a host new or changed since it was last seen) and what a user edit to an attached
// prop means (it becomes a plain prop). The editor runs it on every store change
// (`subscribeToAttachedObjects`).

import type { AssetChild, PathChild } from '../../shared/types';
import type { DungeonLayer, Layer, PlateauChild } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import { useStore } from '../../store/store';
import { GRID_CELL_PX, getCatalogEntry, pathKit, pathKits, type PathKit } from '../../assets/packCatalog';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { pathOutline, pointInPath } from '../../geometry/pathGeometry';
import { flattenRing } from '../../shared/bezier';
import { pointInRing } from '../../shared/roomUtils';
import { edgeWalk, type EdgeUnit, type UnitPlacement } from './pathKitLayout';
import { kitEdgeUnits, paintedSize } from './kitUnits';
import { groupOutline, groupPaths } from '../pathRenderer';
import { CLIFF_FOOT_KIT } from '../plateauKit';
import { FOOT_OUT, FOOT_SPREAD, layerFootUnits } from '../plateauRenderer';

type Side = -1 | 0 | 1;

/** A kit object as the walk lays it: an edge unit that is a prop, on one side of the outline. */
export interface ObjectUnit extends EdgeUnit {
  assetId: string;
  side: Side;
  /** The prop's size as placed, cells: its whole image, padding and all. */
  width: number;
  height: number;
  label: string;
}

/** How far past a path's outline its objects stand clear of the edge units, cells. */
const PATH_CLEAR = 0.3;
/** How far past a cliff's foot band its objects stand, cells. */
const FOOT_CLEAR = FOOT_OUT + FOOT_SPREAD + 0.3;

/** The kit's objects the catalogue has art for. A key with a `pack:` prefix names another pack's entry. */
export function kitObjects(kit: PathKit): ObjectUnit[] {
  const out: ObjectUnit[] = [];
  for (const o of kit.manifest.objects ?? []) {
    const assetId = o.key.includes(':') ? o.key : `${kit.packId}:${o.key}`;
    const entry = getCatalogEntry(assetId);
    if (!entry) continue;
    const { w, h } = paintedSize(entry);
    out.push({
      key: o.key,
      weight: o.weight,
      spacing: o.spacing,
      jitter: o.jitter,
      side: o.side,
      size: Math.max(w, h),
      scale: 1,
      assetId,
      width: entry.naturalWidth / GRID_CELL_PX,
      height: entry.naturalHeight / GRID_CELL_PX,
      label: entry.label,
    });
  }
  return out;
}

/** A host: a path, or a plateau whose cliffs take the cliff foot kit's objects. */
type Host = { kind: 'path'; child: PathChild } | { kind: 'plateau'; child: PlateauChild };

/** Whether a plateau is a plot whose cliff takes objects: raised or sunk, with a cliff edge. */
const isPlot = (s: PlateauChild): boolean => !!s.height && s.edge === 'cliff';

/** Every host on a layer, paths first, in child order. */
export function hostsOf(layer: DungeonLayer): Host[] {
  const out: Host[] = [];
  for (const c of layer.children) if (c.childType === 'path' && c.visible) out.push({ kind: 'path', child: c });
  for (const c of layer.children) if (c.childType === 'plateau' && c.visible && isPlot(c)) out.push({ kind: 'plateau', child: c });
  return out;
}

function hostKit(host: Host): PathKit | undefined {
  return host.kind === 'path' ? pathKit(host.child.materialId) : pathKits().find((k) => k.set === CLIFF_FOOT_KIT);
}

/**
 * The lines a host's objects on `side` are walked along: the host's outline pushed `d` cells
 * away from it (out of a path, down off a plot), into it for side -1, the outline itself for
 * side 0. Each ring is pushed both ways and the way that lands on the asked side is kept, so
 * a moat's inner bank and a pit's rim come out right.
 */
function hostLines(host: Host, side: Side, d: number): Polygon[] {
  const rings: Polygon[] =
    host.kind === 'path'
      ? pathOutline(host.child).filter((r) => r.length >= 3)
      : [flattenRing(host.child.contours[0] ?? [], host.child.tangents?.[0])];
  if (side === 0) return rings;
  // "Away" from a plot is its low side: out of a plateau, into a pit.
  const outward = host.kind === 'path' || host.child.height > 0 ? side : -side;
  const inside = (p: [number, number]) =>
    host.kind === 'path' ? pointInPath(host.child, p) : pointInRing(p[0], p[1], rings[0]);
  const out: Polygon[] = [];
  for (const ring of rings) {
    for (const sign of [1, -1]) {
      const pushed = clipper2Engine.inflate([ring], sign * d).filter((r) => r.length >= 3);
      if (pushed.length > 0 && inside(pushed[0][0]) === outward < 0) {
        out.push(...pushed);
        break;
      }
    }
  }
  return out;
}

/** The point of `line` (a closed ring) nearest (x, y): how far off it is, and its arc fraction along the ring. */
function along(line: Polygon, x: number, y: number): { d: number; t: number } {
  let total = 0;
  let best = { d: Infinity, s: 0 };
  for (let i = 0; i < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[(i + 1) % line.length];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) {
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
      const dist = Math.hypot(x - ax - dx * u, y - ay - dy * u);
      if (dist < best.d) best = { d: dist, s: total + len * u };
    }
    total += len;
  }
  return { d: best.d, t: total > 0 ? best.s / total : 0 };
}

/** The arc fraction along whichever of `lines` (x, y) lies on. */
function tOn(lines: readonly Polygon[], x: number, y: number): number {
  let best = { d: Infinity, t: 0 };
  for (const l of lines) {
    const a = along(l, x, y);
    if (a.d < best.d) best = a;
  }
  return best.t;
}

/** What stands on a layer before any objects: every path's edge units and every cliff's foot units. */
export function layerUnits(layer: DungeonLayer): UnitPlacement[] {
  const out: UnitPlacement[] = [];
  const paths = layer.children.filter((c): c is PathChild => c.childType === 'path');
  for (const group of groupPaths(paths)) {
    const kit = pathKit(group.paths[0].materialId);
    if (!kit) continue;
    const rings = groupOutline(group.paths);
    if (rings.length > 0) out.push(...edgeWalk(rings, kitEdgeUnits(kit).units, group.paths[0].id, group.paths));
  }
  out.push(...layerFootUnits(layer));
  return out;
}

/** A prop's footprint as the walk tests it: a disc as wide as its larger side. */
const footprint = (a: AssetChild) => ({ x: a.position.x, y: a.position.y, size: Math.max(a.width, a.height) * a.scale });

/**
 * The attached props of the hosts named in `ids`, laid afresh: per host and per side, the
 * kit's objects walked along the host's line on that side, seeded by the host's id, clear of
 * `blockers` (footprints already on the layer), of each other and of every path's surface
 * (none on a road, though lily pads on their own lake). Their ids are `<host>~<n>`, skipping
 * ids in `taken`.
 */
export function layAttached(
  layer: DungeonLayer,
  ids: ReadonlySet<string>,
  blockers: readonly { x: number; y: number; size: number }[],
  taken: ReadonlySet<string> = new Set(),
): AssetChild[] {
  const out: AssetChild[] = [];
  const avoid = [...blockers];
  const paths = layer.children.filter((c): c is PathChild => c.childType === 'path' && c.visible);
  for (const host of hostsOf(layer)) {
    if (!ids.has(host.child.id)) continue;
    const kit = hostKit(host);
    const objects = kit ? kitObjects(kit) : [];
    let n = 0;
    for (const side of [1, 0, -1] as const) {
      const units = objects.filter((o) => o.side === side);
      if (units.length === 0) continue;
      const clear = host.kind === 'path' ? PATH_CLEAR : FOOT_CLEAR;
      const d = side === 0 ? 0 : clear + Math.max(...units.map((u) => u.size)) / 2;
      const lines = hostLines(host, side, d);
      const laid = edgeWalk(lines, units, `${host.child.id}|${side}`, [], { avoid });
      for (const u of laid) {
        const p: [number, number] = [u.x, u.y];
        // Never on a road; on the host's own surface only when asked to be (lily pads).
        if (paths.some((q) => (q.id !== host.child.id || side > 0) && pointInPath(q, p))) continue;
        const unit = units.find((o) => o.key === u.key)!;
        let id = `${host.child.id}~${n++}`;
        while (taken.has(id)) id = `${host.child.id}~${n++}`;
        out.push({
          id,
          name: unit.label,
          childType: 'asset',
          visible: true,
          objectType: 'asset',
          assetId: unit.assetId,
          position: { x: u.x, y: u.y },
          rotation: u.rotation,
          scale: 1,
          width: unit.width,
          height: unit.height,
          tint: '#ffffff',
          flipX: false,
          flipY: false,
          attachedTo: { kind: host.kind, id: host.child.id, t: tOn(lines, u.x, u.y), side },
        });
        avoid.push({ x: u.x, y: u.y, size: u.size });
      }
    }
  }
  return out;
}

// ─── When to lay ───────────────────────────────────────────

/** Whether an attached prop stands as it was laid: a move, turn, resize or swap says a hand touched it. */
function asLaid(a: AssetChild, b: AssetChild): boolean {
  const near = (p: number, q: number) => Math.abs(p - q) < 1e-6;
  return (
    a.assetId === b.assetId &&
    near(a.position.x, b.position.x) &&
    near(a.position.y, b.position.y) &&
    near(a.rotation, b.rotation) &&
    near(a.scale, b.scale) &&
    near(a.width, b.width) &&
    near(a.height, b.height)
  );
}

/** An attached prop let go of its host: a plain prop where it stands. */
function plain(a: AssetChild): AssetChild {
  const out = { ...a };
  delete out.attachedTo;
  return out;
}

/** Two lists of attached props the same, piece for piece. */
function sameLaid(a: readonly AssetChild[], b: readonly AssetChild[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && asLaid(x, b[i]) && x.attachedTo?.side === b[i].attachedTo?.side);
}

/**
 * The bookkeeping that runs attached objects in the editor. Handed the store's layers on every
 * change (and `rev`, which moves when a map is loaded), it answers the children each changed
 * layer should have now, or nothing:
 * - a map just loaded is taken as it stands (its hosts and attached props remembered, nothing
 *   laid), so a saved map opens unchanged;
 * - a host new or changed since it was last seen has its objects laid again, and so does any
 *   host with an object standing where a new or moved path now runs; a host gone takes its
 *   objects with it;
 * - an attached prop a hand has moved, turned, resized or swapped becomes a plain prop where it
 *   is; one put back as it was laid (an undo) stays attached.
 */
export function createAttachedSync(): (layers: readonly Layer[], rev: number) => Map<string, DungeonLayer['children']> | null {
  let lastRev: number | null = null;
  const hosts = new Map<string, Map<string, unknown>>();
  const laid = new Map<string, AssetChild>();
  return (layers, rev) => {
    const fresh = rev !== lastRev;
    lastRev = rev;
    const writes = new Map<string, DungeonLayer['children']>();
    const live = new Set<string>();
    for (const layer of layers) {
      if (layer.type !== 'dungeon') continue;
      live.add(layer.id);
      const seen = hosts.get(layer.id);
      const now = new Map<string, unknown>(hostsOf(layer).map((h) => [h.child.id, h.child]));
      hosts.set(layer.id, now);
      const attached = layer.children.filter((c): c is AssetChild => c.childType === 'asset' && !!c.attachedTo);
      if (fresh || !seen) {
        for (const a of attached) laid.set(a.id, a);
        continue;
      }
      const changed = new Set<string>();
      for (const [id, child] of now) if (seen.get(id) !== child) changed.add(id);
      const gone = new Set([...seen.keys()].filter((id) => !now.has(id)));
      // A path drawn or moved over another host's objects has that host's objects laid again,
      // so none is left standing on the new road.
      const moved = layer.children.filter((c): c is PathChild => c.childType === 'path' && changed.has(c.id));
      for (const a of attached) {
        const host = a.attachedTo!.id;
        if (!changed.has(host) && moved.some((p) => pointInPath(p, [a.position.x, a.position.y]))) changed.add(host);
      }
      // A prop a hand moved lets go of its host, unless the host moved too (it is laid again).
      const handled = attached.filter((a) => {
        const was = laid.get(a.id);
        return !!was && !changed.has(a.attachedTo!.id) && !gone.has(a.attachedTo!.id) && !asLaid(a, was);
      });
      for (const a of attached) laid.set(a.id, a);
      if (changed.size === 0 && gone.size === 0 && handled.length === 0) continue;

      const loose = new Set(handled.map((a) => a.id));
      const relay = (a: AssetChild) => changed.has(a.attachedTo!.id) || gone.has(a.attachedTo!.id);
      const kept = layer.children.filter((c) => !(c.childType === 'asset' && c.attachedTo && !loose.has(c.id) && relay(c)));
      const blockers = [
        ...layerUnits(layer),
        ...kept.filter((c): c is AssetChild => c.childType === 'asset').map(footprint),
      ];
      const relaid = layAttached(layer, changed, blockers, new Set(kept.map((c) => c.id)));
      const before = attached.filter((a) => changed.has(a.attachedTo!.id));
      if (loose.size === 0 && gone.size === 0 && sameLaid(before, relaid)) continue;
      const next = [...kept.map((c) => (loose.has(c.id) ? plain(c as AssetChild) : c)), ...relaid] as DungeonLayer['children'];
      for (const a of relaid) laid.set(a.id, a);
      writes.set(layer.id, next);
    }
    for (const id of [...hosts.keys()]) if (!live.has(id)) hosts.delete(id);
    return writes.size > 0 ? writes : null;
  };
}

/**
 * Keeps attached objects laid in the editor: on every store change, the layers whose hosts
 * changed get their objects laid again (createAttachedSync), written straight into the
 * layers. Not an undo step of its own: undoing a host's edit brings the host back, and the
 * objects are laid again from it, where they were.
 */
export function subscribeToAttachedObjects(): () => void {
  const sync = createAttachedSync();
  let writing = false;
  const run = () => {
    if (writing) return;
    const state = useStore.getState();
    const writes = sync(state.layers, state.terrainSplats.rev);
    if (!writes) return;
    writing = true;
    try {
      useStore.setState((s) => {
        for (const layer of s.layers) {
          const next = writes.get(layer.id);
          if (next && layer.type === 'dungeon') layer.children = next;
        }
      });
    } finally {
      writing = false;
    }
  };
  run();
  return useStore.subscribe(run);
}
