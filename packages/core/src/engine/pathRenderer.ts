// Paths on the canvas. A path's material is a kit of pieces (assets/packCatalog.ts
// `pathKits`): its outline filled with the kit's fill tile, painted the way a floor is
// (floorWallRenderer `paintTiled`), and the kit's units laid along it by the walkers in
// path/pathKitLayout.ts. Paths of one material and sort on a layer form a group whose
// outlines are unioned before the fill and the walk, so crossing roads are one surface with
// one border by geometry. Each group draws in its sort's sublayer: `under` over the floor,
// `over` above the layer's props, `overhead` above the tokens.
//
// The units are pooled sprites, one pool per group kept across redraws, re-laid on every
// edit the way the cave band is (caveBandRenderer `placeBand`).

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { useStore } from '../store/store';
import { getLayerEntry, getOverheadContainer } from './sceneGraph';
import { pathOutline, pointInPath } from '../geometry/pathGeometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { GRID_CELL_PX, kitPiece, pathKit, type CatalogEntry, type PathKit } from '../assets/packCatalog';
import { getAssetPackManager } from './assetPackInstance';
import * as textureLoader from '../assets/textureLoader';
import { paintTiled } from './floorWallRenderer';
import { edgeWalk, layPlanks, type EdgeUnit, type PlanksKit } from './path/pathKitLayout';
import type { PathChild } from '../shared/types';
import type { Polygon } from '../types/geometry';
import { SEE_UNDER_ALPHA } from './subscribeToAssets';

/** The stand-in for a kit that is not installed, or ships no fill: drawn flat, so the path stays findable. */
const MISSING_COLOUR = 0x8a8a8a;
/** Overhead paths sit just under the overhead props of their own layer (see subscribeToAssets). */
const LAYER_Z = 1e5;

function parseHex(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

// ─── Textures, as they arrive ───────────────────────────────

let epoch = 0;
const pending = new Set<string>();
let onArrive: (() => void) | null = null;

/** The texture for a pack id if it is in hand; otherwise asks for it and redraws when it lands. */
function textureNow(id: string | undefined): Texture | null {
  if (!id) return null;
  const tex = getAssetPackManager().getTextureOrNull(id);
  if (tex && tex.width > 1) return tex;
  if (!pending.has(id)) {
    pending.add(id);
    void textureLoader.load(id).then((t) => {
      pending.delete(id);
      if (t.width > 1) {
        epoch++;
        onArrive?.();
      }
    });
  }
  return null;
}

// ─── Groups ─────────────────────────────────────────────────

interface Group {
  key: string;
  paths: PathChild[];
}

/** The group a path joins: same material and sort share one fill; overhead paths stand alone. */
export function groupKey(path: PathChild): string {
  return `${path.materialId}|${path.sort}${path.sort === 'overhead' ? `|${path.id}` : ''}`;
}

/** The groups of a set of paths, ordered by where each group first appears in child order. */
export function groupPaths(paths: readonly PathChild[]): Group[] {
  const groups = new Map<string, Group>();
  for (const p of paths) {
    if (!p.visible) continue;
    const key = groupKey(p);
    const g = groups.get(key);
    if (g) g.paths.push(p);
    else groups.set(key, { key, paths: [p] });
  }
  return [...groups.values()];
}

/**
 * The outline a group fills: every path's outline (its ribbon, and its interior when closed
 * and filled) unioned, so where two paths cross there is one surface and no seam. Holes (the
 * middle of an unfilled closed path) come back as negative rings.
 */
export function groupOutline(paths: readonly PathChild[]): Polygon[] {
  const rings = paths.flatMap((p) => pathOutline(p)).filter((r) => r.length >= 3);
  if (rings.length === 0) return [];
  return clipper2Engine.union(rings, []);
}

// ─── Drawing ────────────────────────────────────────────────

/** The outline filled with the kit's fill tile like a floor; flat grey when the kit is missing. */
function drawFill(parent: Container, rings: Polygon[], kit: PathKit | undefined, head: PathChild): void {
  const fill = kit?.fill ? textureNow(kit.fill.id) : null;
  if (kit?.fill && !fill) return;
  if (!fill) {
    // A kit with no fill of its own (planks) is all pieces.
    if (kit) return;
    const g = new Graphics();
    for (const r of rings) g.poly(r.flat());
    g.fill({ color: MISSING_COLOUR, alpha: 0.6 * head.opacity });
    g.label = 'path-fill';
    parent.addChild(g);
    return;
  }
  paintTiled(parent, rings, fill, { scale: 1, tint: parseHex(head.tint), alpha: head.opacity, holes: true });
  parent.children[parent.children.length - 1].label = 'path-fill';
}

/** A piece to draw: its pack entry, centre, turn, and size against the authored one. */
interface Piece {
  entry: CatalogEntry;
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

/** A piece's painted width and height, cells: its content rect, else its grid size. */
function paintedSize(entry: CatalogEntry): { w: number; h: number } {
  const cr = entry.contentRect;
  if (cr) return { w: cr.w / GRID_CELL_PX, h: cr.h / GRID_CELL_PX };
  const [w, h] = entry.gridSize.split('x').map(Number);
  return { w, h };
}

/** A unit's footprint across, cells. */
function unitSize(entry: CatalogEntry): number {
  const { w, h } = paintedSize(entry);
  return Math.max(w, h);
}

/** The kit's edge units the pack has art for, and their entries by key. */
function edgeUnits(kit: PathKit): { units: EdgeUnit[]; entries: Map<string, CatalogEntry> } {
  const units: EdgeUnit[] = [];
  const entries = new Map<string, CatalogEntry>();
  for (const u of kit.manifest.edge ?? []) {
    const entry = kitPiece(kit, u.key);
    if (!entry) continue;
    entries.set(u.key, entry);
    units.push({ ...u, size: unitSize(entry) });
  }
  return { units, entries };
}

/** The kit's planks, post and end piece the pack has art for, and their entries by key. */
function planksOf(kit: PathKit): { planks: PlanksKit; entries: Map<string, CatalogEntry> } {
  const entries = new Map<string, CatalogEntry>();
  const has = (key: string | undefined): CatalogEntry | undefined => {
    const entry = key ? kitPiece(kit, key) : undefined;
    if (entry && key) entries.set(key, entry);
    return entry;
  };
  const planks: PlanksKit = { cross: [] };
  for (const c of kit.manifest.cross ?? []) {
    const entry = has(c.key);
    if (!entry) continue;
    const { w, h } = paintedSize(entry);
    planks.cross.push({ key: c.key, weight: c.weight, length: w, thickness: h });
  }
  if (has(kit.manifest.railPost)) planks.post = kit.manifest.railPost;
  const end = has(kit.manifest.end);
  if (end && kit.manifest.end) planks.end = { key: kit.manifest.end, length: paintedSize(end).w };
  return { planks, entries };
}

/** Placements as pieces (authored size unless they carry a scale); art not yet in hand is asked for and skipped. */
function piecesOf(
  placed: readonly { key: string; x: number; y: number; rotation: number; scale?: number }[],
  entries: Map<string, CatalogEntry>,
): Piece[] {
  const out: Piece[] = [];
  for (const p of placed) {
    const entry = entries.get(p.key);
    if (!entry || !textureNow(entry.id)) continue;
    out.push({ entry, x: p.x, y: p.y, rotation: p.rotation, scale: p.scale ?? 1 });
  }
  return out;
}

/** A pooled Graphics at slot `at` of `pool`, cleared: where the pieces drawn in code go. */
function graphicsAt(pool: Container, at: number): Graphics {
  const slot = pool.children[at];
  if (slot instanceof Graphics) return slot.clear();
  const g = new Graphics();
  pool.addChildAt(g, at);
  return g;
}

/**
 * Fill `pool` from index `from` with one sprite per piece, reusing the sprites already there.
 * The sprite pivots on its tile's centre even when its texture arrived trimmed to the content
 * rect, as the cave band's do. Returns the next free index.
 */
function placePieces(pool: Container, pieces: readonly Piece[], tint: number, from: number): number {
  let at = from;
  for (const p of pieces) {
    const tex = textureLoader.resolveTexture(p.entry.id);
    if (tex.width <= 1) continue;
    const slot = pool.children[at];
    let sprite: Sprite;
    if (slot instanceof Sprite) {
      sprite = slot;
      sprite.texture = tex;
    } else {
      sprite = new Sprite(tex);
      pool.addChildAt(sprite, at);
    }
    const cr = p.entry.contentRect;
    if (cr) sprite.anchor.set((p.entry.naturalWidth / 2 - cr.x) / cr.w, (p.entry.naturalHeight / 2 - cr.y) / cr.h);
    else sprite.anchor.set(0.5, 0.5);
    sprite.position.set(p.x, p.y);
    sprite.rotation = p.rotation;
    const px = cr ? cr.w : p.entry.naturalWidth;
    sprite.scale.set(((px / tex.width) * p.scale) / GRID_CELL_PX);
    sprite.tint = tint;
    at++;
  }
  return at;
}

/** One group into `parent`: its fill, then its pieces in the group's pool. */
function drawGroup(parent: Container, group: Group, pool: Container): void {
  const rings = groupOutline(group.paths);
  const head = group.paths[0];
  const kit = pathKit(head.materialId);
  if (rings.length > 0) drawFill(parent, rings, kit, head);
  const tint = parseHex(head.tint);
  let at = 0;
  if (kit && rings.length > 0) {
    const { units, entries } = edgeUnits(kit);
    at = placePieces(pool, piecesOf(edgeWalk(rings, units, head.id, group.paths), entries), tint, at);
  }
  if (kit?.kind === 'planks') {
    const { planks, entries } = planksOf(kit);
    const rope = kit.manifest.rope;
    for (const path of group.paths) {
      const laid = layPlanks(path, planks, path.id);
      at = placePieces(pool, piecesOf([...laid.planks, ...laid.ends], entries), tint, at);
      if (rope && laid.ropes.length > 0) {
        const g = graphicsAt(pool, at++);
        for (const [a, b] of laid.ropes) g.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
        g.stroke({ color: parseHex(rope.color), width: rope.width, cap: 'round' });
      }
      at = placePieces(pool, piecesOf(laid.posts, entries), tint, at);
    }
  }
  for (const c of pool.children.slice(at)) c.destroy();
  pool.alpha = head.opacity;
  parent.addChild(pool);
}

function clear(container: Container): void {
  for (const c of container.removeChildren()) c.destroy({ children: true });
}

// ─── Overhead paths at the table ────────────────────────────

const overhead = new Map<string, { container: Container; path: PathChild; base: number }>();
const fades = new Map<string, number>();

/** Every overhead path on the map (bridges): what the table fades for a token beneath. */
export function overheadPathEntries(): {
  childId: string;
  contains: (x: number, y: number) => boolean;
  /** What the path is drawn at now, fade included. */
  alpha: number;
  /** Whether its art has been drawn yet. */
  drawn: boolean;
}[] {
  return [...overhead.values()].map(({ path, container }) => ({
    childId: path.id,
    contains: (x: number, y: number) => pointInPath(path, [x, y]),
    alpha: container.alpha,
    drawn: container.children.length > 0,
  }));
}

/** Fade one overhead path; 1 puts it back. */
export function setOverheadPathFade(childId: string, alpha: number): void {
  if (alpha === 1) fades.delete(childId);
  else fades.set(childId, alpha);
  const e = overhead.get(childId);
  if (e) e.container.alpha = e.base * alpha;
}

// ─── Subscription ───────────────────────────────────────────

interface Drawn {
  under: Container;
  /** Each group's pieces, by group key: kept across redraws. */
  pools: Map<string, Container>;
  paths: PathChild[];
  epoch: number;
  index: number;
  look: string;
  overhead: Container[];
}

/**
 * Keeps every dungeon layer's paths drawn. A layer redraws when its paths change (the store
 * hands back new child objects on any edit), when its scene entry is new, or when art it was
 * waiting for arrives.
 */
export function subscribeToPaths(): () => void {
  const drawn = new Map<string, Drawn>();
  const sync = () => {
    const started = performance.now();
    const state = useStore.getState();
    const live = new Set<string>();
    let anyRedrawn = false;
    state.layers.forEach((layer, index) => {
      if (layer.type !== 'dungeon') return;
      live.add(layer.id);
      const sub = getLayerEntry(layer.id)?.sublayers;
      if (!sub) return;
      const paths = layer.children.filter((c): c is PathChild => c.childType === 'path');
      const look = `${layer.opacity}|${state.ui.seeUnderOverhead}`;
      const prev = drawn.get(layer.id);
      if (
        prev &&
        prev.under === sub.paths &&
        prev.epoch === epoch &&
        prev.index === index &&
        prev.look === look &&
        prev.paths.length === paths.length &&
        prev.paths.every((p, i) => p === paths[i])
      ) {
        return;
      }
      anyRedrawn = true;
      // The pools step out before the clear and are put back by their group's draw.
      for (const pool of prev?.pools.values() ?? []) pool.removeFromParent();
      const pools = new Map<string, Container>();
      const poolOf = (key: string): Container => {
        let pool = prev?.pools.get(key);
        if (!pool) {
          pool = new Container();
          pool.label = 'path-units';
        }
        pools.set(key, pool);
        return pool;
      };
      clear(sub.paths);
      clear(sub.pathsOver);
      for (const c of prev?.overhead ?? []) c.destroy({ children: true });
      for (const p of prev?.paths ?? []) overhead.delete(p.id);
      const tops: Container[] = [];
      const top = getOverheadContainer();
      for (const group of groupPaths(paths)) {
        const sort = group.paths[0].sort;
        if (sort === 'overhead' && top) {
          const c = new Container();
          c.label = `path-overhead-${group.paths[0].id}`;
          c.zIndex = index * LAYER_Z - 1;
          const base = layer.opacity * (state.ui.seeUnderOverhead ? SEE_UNDER_ALPHA : 1);
          c.alpha = base * (fades.get(group.paths[0].id) ?? 1);
          drawGroup(c, group, poolOf(group.key));
          top.addChild(c);
          tops.push(c);
          overhead.set(group.paths[0].id, { container: c, path: group.paths[0], base });
        } else {
          drawGroup(sort === 'over' ? sub.pathsOver : sub.paths, group, poolOf(group.key));
        }
      }
      for (const [key, pool] of prev?.pools ?? []) if (!pools.has(key)) pool.destroy({ children: true });
      drawn.set(layer.id, { under: sub.paths, pools, paths, epoch, index, look, overhead: tops });
    });
    for (const [id, d] of drawn) {
      if (live.has(id)) continue;
      for (const c of d.overhead) c.destroy({ children: true });
      for (const pool of d.pools.values()) if (!pool.destroyed) pool.destroy({ children: true });
      drawn.delete(id);
    }
    // Read by the e2e lane: how long the last layer redraw took.
    if (anyRedrawn) (globalThis as { __pathRedrawMs?: number }).__pathRedrawMs = performance.now() - started;
  };
  onArrive = sync;
  sync();
  const unsub = useStore.subscribe(sync);
  return () => {
    unsub();
    onArrive = null;
    overhead.clear();
  };
}
