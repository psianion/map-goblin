// Paths on the canvas. A path's material is a kit of pieces (assets/packCatalog.ts
// `pathKits`); for now a path draws as its outline filled with the kit's fill tile, painted
// the way a floor is (floorWallRenderer `paintTiled`). The walkers that lay the kit's
// units along the outline come next. Paths of one material and sort on a layer form a
// group whose outlines are unioned before the fill, so crossing roads are one surface by
// geometry. Each group draws in its sort's sublayer: `under` over the floor, `over` above
// the layer's props, `overhead` above the tokens.

import { Container, Graphics, type Texture } from 'pixi.js';
import { useStore } from '../store/store';
import { getLayerEntry, getOverheadContainer } from './sceneGraph';
import { pathOutline, pointInPath } from '../geometry/pathGeometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { pathKit } from '../assets/packCatalog';
import { getAssetPackManager } from './assetPackInstance';
import * as textureLoader from '../assets/textureLoader';
import { paintTiled } from './floorWallRenderer';
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

/** One group into `parent`: its outline, filled with the kit's fill tile like a floor. */
function drawGroup(parent: Container, group: Group): void {
  const rings = groupOutline(group.paths);
  if (rings.length === 0) return;
  const head = group.paths[0];
  const kit = pathKit(head.materialId);
  const fill = kit?.fill ? textureNow(kit.fill.id) : null;
  if (kit?.fill && !fill) return;
  if (!fill) {
    const g = new Graphics();
    for (const r of rings) g.poly(r.flat());
    g.fill({ color: MISSING_COLOUR, alpha: 0.6 * head.opacity });
    parent.addChild(g);
    return;
  }
  paintTiled(parent, rings, fill, { scale: 1, tint: parseHex(head.tint), alpha: head.opacity, holes: true });
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
          drawGroup(c, group);
          top.addChild(c);
          tops.push(c);
          overhead.set(group.paths[0].id, { container: c, path: group.paths[0], base });
        } else {
          drawGroup(sort === 'over' ? sub.pathsOver : sub.paths, group);
        }
      }
      drawn.set(layer.id, { under: sub.paths, paths, epoch, index, look, overhead: tops });
    });
    for (const [id, d] of drawn) {
      if (live.has(id)) continue;
      for (const c of d.overhead) c.destroy({ children: true });
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
