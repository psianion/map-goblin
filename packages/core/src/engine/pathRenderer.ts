// Paths on the canvas: each a textured ribbon (engine/path/ribbonShader.ts) in its sort's
// sublayer — `under` over the floor, `over` above the layer's props, `overhead` above the
// tokens — with its material's edge strips beside it, a filled closed path's interior
// tiled with the material's fill, and fall sprites where the plateau code says a liquid
// crosses a cliff. Paths of one material, sort and edge on a layer form a group that
// shares one feathered outline (engine/path/junctionMask.ts), so crossing roads read as
// one surface.

import { Container, Graphics, TilingSprite, type Texture } from 'pixi.js';
import { useStore } from '../store/store';
import { getLayerEntry, getOverheadContainer } from './sceneGraph';
import type { RenderEngine } from './RenderEngine';
import { pathCentreline, pointInPath } from '../geometry/pathGeometry';
import { buildEdgeStrips, buildRibbonMesh, type RibbonMesh } from '../geometry/ribbon';
import { getCatalogEntry, pathMaterial, type PathMaterial } from '../assets/packCatalog';
import { getAssetPackManager } from './assetPackInstance';
import * as textureLoader from '../assets/textureLoader';
import { averageColour } from '../assets/textureColour';
import type { PathChild } from '../shared/types';
import { DEFAULT_EDGE_WIDTH, ribbonMeshObject, type RibbonLook } from './path/ribbonShader';
import { groupMask, type GroupMask } from './path/junctionMask';
import { cliffCrossingsOf, drawFalls, waterfallSpans } from './path/waterfalls';
import { SEE_UNDER_ALPHA } from './subscribeToAssets';

/** An edge strip's width when the material says nothing else, cells. */
export const EDGE_STRIP_WIDTH = 0.5;
/** How far an edge strip tucks under a soft-edged ribbon, cells: past the ribbon's whole feather. */
export const EDGE_STRIP_INSET = 0.5;

/**
 * Keeps an edge strip's art where it belongs when the strip reaches `inset` under the ribbon:
 * V = 0 stays at the ribbon's edge, and the tucked-in part takes V below 0, which the shader
 * clamps to the art's inner row (solid). The inner vertices are the strip's first side.
 */
export function tuckEdgeStrip(mesh: RibbonMesh, inset: number, stripWidth: number): void {
  if (inset <= 0) return;
  for (let k = 0; k < mesh.uvs.length; k += 4) mesh.uvs[k + 1] = -inset / stripWidth;
}
/** The stand-in for a material that is not installed: drawn flat, so the path stays findable. */
const MISSING_COLOUR = 0x8a8a8a;
/** Overhead paths sit just under the overhead props of their own layer (see subscribeToAssets). */
const LAYER_Z = 1e5;
/** A filled interior takes the fill art this much darker: the deep water. */
const DEEP = 0.75;

function parseHex(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

function scale(colour: number, k: number): number {
  const ch = (shift: number) => Math.min(255, Math.round(((colour >> shift) & 0xff) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A strip's length along U in cells: its grid width. */
function cellsWide(id: string): number {
  return parseInt(getCatalogEntry(id)?.gridSize.split('x')[0] ?? '1', 10) || 1;
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

// ─── Looks ──────────────────────────────────────────────────

/** How one path's ribbon draws, before a group mask replaces its own edge. */
export function pathLook(path: PathChild, material: PathMaterial, stripId: string, length: number): RibbonLook {
  return {
    stripLength: cellsWide(stripId),
    tint: parseHex(path.tint),
    opacity: path.opacity,
    soft: path.edge === 'soft',
    edgeWidth: DEFAULT_EDGE_WIDTH,
    fadeStart: !path.closed && path.ends.start === 'fade',
    fadeEnd: !path.closed && path.ends.end === 'fade',
    fadeLength: path.ends.length,
    length,
    flip: path.flip,
    // A liquid (a material with a fill) is shallow at its banks and deep down the middle.
    water: !!material.pieces.fill,
  };
}

/** The group a path joins: same material, sort and edge share one outline; overhead paths stand alone. */
export function groupKey(path: PathChild): string {
  return `${path.materialId}|${path.sort}|${path.edge}${path.sort === 'overhead' ? `|${path.id}` : ''}`;
}

/** What a group's shared mask is a function of: the geometry and look of every path in it. */
export function groupSignature(paths: readonly PathChild[]): string {
  return JSON.stringify(paths.map((p) => [p.id, p.points, p.closed, p.width, p.ends, p.edge, p.materialId, p.sort]));
}

// ─── Drawing ────────────────────────────────────────────────

/**
 * The interior of a closed path as one polygon (its flattened centreline), filled: Pixi's
 * polygon fill triangulates it with earcut, so a concave shore fills exactly. Null for too few points.
 */
export function fillMask(path: PathChild): Graphics | null {
  const ring = pathCentreline(path).xy.slice(0, -1);
  if (ring.length < 3) return null;
  return new Graphics().poly(ring.flat()).fill({ color: 0xffffff });
}

function drawFill(parent: Container, path: PathChild, material: PathMaterial, strip: Texture): void {
  const ring = pathCentreline(path).xy.slice(0, -1);
  const mask = fillMask(path);
  if (!mask) return;
  const tint = scale(parseHex(path.tint), DEEP);
  const fill = textureNow(material.pieces.fill?.id);
  if (!fill) {
    // No fill art: the strip's own colour, deeper.
    const avg = averageColour(strip) ?? MISSING_COLOUR;
    const g = new Graphics().poly(ring.flat()).fill({ color: scale(avg, DEEP), alpha: path.opacity });
    g.tint = parseHex(path.tint);
    parent.addChild(g);
    mask.destroy();
    return;
  }
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const tileScale = 1 / 200;
  const ts = new TilingSprite({
    texture: fill,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    tileScale: { x: tileScale, y: tileScale },
  });
  ts.position.set(minX, minY);
  // Anchored to the world origin, like floor fills, so neighbouring pools tile as one.
  ts.tilePosition.set(-minX / tileScale, -minY / tileScale);
  ts.tint = tint;
  ts.alpha = path.opacity;
  const holder = new Container();
  holder.addChild(ts, mask);
  holder.mask = mask;
  parent.addChild(holder);
}

function drawMissing(parent: Container, path: PathChild): void {
  const mesh = buildRibbonMesh(pathCentreline(path), { ends: path.ends });
  const p = mesh.positions;
  const g = new Graphics();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t] * 2, mesh.indices[t + 1] * 2, mesh.indices[t + 2] * 2];
    g.poly([p[a], p[a + 1], p[b], p[b + 1], p[c], p[c + 1]]);
  }
  g.fill({ color: MISSING_COLOUR, alpha: 0.6 * path.opacity });
  parent.addChild(g);
}

interface Group {
  key: string;
  paths: PathChild[];
}

/**
 * One group into `parent`: fills, then edge strips, then the ribbons, then the falls — so a
 * verge never covers a road of its own material and a bank sits outside its lake.
 */
function drawGroup(
  engine: RenderEngine | null,
  parent: Container,
  group: Group,
  masks: Map<string, GroupMask>,
  maskKey: string,
  used: Set<string>,
): void {
  const head = group.paths[0];
  const material = pathMaterial(head.materialId);
  if (!material) {
    for (const p of group.paths) drawMissing(parent, p);
    return;
  }
  const stripId = material.pieces.strip!.id;
  const strip = textureNow(stripId);
  if (!strip) return;

  for (const p of group.paths) if (p.closed && p.fill) drawFill(parent, p, material, strip);

  const edge = textureNow(material.pieces.edge?.id);
  if (edge) {
    for (const p of group.paths) {
      if (!p.edgeStrip) continue;
      const line = pathCentreline(p);
      // Under a soft edge the strip reaches in under the ribbon's feather, solid there, so
      // whatever shows through the fading ribbon is the strip and never the ground.
      const inset = p.edge === 'soft' ? EDGE_STRIP_INSET : 0;
      const { left, right } = buildEdgeStrips(line, EDGE_STRIP_WIDTH, {}, inset);
      const look: RibbonLook = {
        ...pathLook(p, material, material.pieces.edge!.id, line.length),
        soft: false,
        water: false,
        flip: false,
      };
      for (const side of [left, right]) {
        tuckEdgeStrip(side, inset, EDGE_STRIP_WIDTH);
        const m = ribbonMeshObject(side, edge, look);
        if (m) parent.addChild(m);
      }
    }
  }

  const meshes: RibbonMesh[] = group.paths.map((p) => buildRibbonMesh(pathCentreline(p), { ends: p.ends, offset: p.offset }));
  let mask: GroupMask | null = null;
  if (engine && group.paths.length >= 2 && head.edge === 'soft') {
    mask = groupMask(engine, masks.get(maskKey), groupSignature(group.paths), meshes, DEFAULT_EDGE_WIDTH);
    if (mask) {
      masks.set(maskKey, mask);
      used.add(maskKey);
    }
  }
  group.paths.forEach((p, i) => {
    const look = pathLook(p, material, stripId, meshes[i].length);
    if (mask) look.mask = { source: mask.source, rect: mask.rect };
    const m = ribbonMeshObject(meshes[i], strip, look);
    if (m) parent.addChild(m);
  });

  const fall = textureNow(material.pieces.fall?.id);
  if (fall) {
    for (const p of group.paths) {
      const crossings = cliffCrossingsOf(p);
      if (crossings.length > 0) drawFalls(parent, fall, waterfallSpans(p, crossings));
    }
  }
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
 * waiting for arrives; a group's mask is rebuilt only when its signature moves. `engine`
 * renders the junction masks; without one, groups draw with their own edges.
 */
export function subscribeToPaths(engine: RenderEngine | null = null): () => void {
  const drawn = new Map<string, Drawn>();
  const masks = new Map<string, GroupMask>();
  const sync = () => {
    const started = performance.now();
    const state = useStore.getState();
    const live = new Set<string>();
    const used = new Set<string>();
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
        for (const key of masks.keys()) if (key.startsWith(`${layer.id}|`)) used.add(key);
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
        const maskKey = `${layer.id}|${group.key}`;
        if (sort === 'overhead' && top) {
          const c = new Container();
          c.label = `path-overhead-${group.paths[0].id}`;
          c.zIndex = index * LAYER_Z - 1;
          const base = layer.opacity * (state.ui.seeUnderOverhead ? SEE_UNDER_ALPHA : 1);
          c.alpha = base * (fades.get(group.paths[0].id) ?? 1);
          drawGroup(engine, c, group, masks, maskKey, used);
          top.addChild(c);
          tops.push(c);
          overhead.set(group.paths[0].id, { container: c, path: group.paths[0], base });
        } else {
          drawGroup(engine, sort === 'over' ? sub.pathsOver : sub.paths, group, masks, maskKey, used);
        }
      }
      drawn.set(layer.id, { under: sub.paths, paths, epoch, index, look, overhead: tops });
    });
    for (const [id, d] of drawn) {
      if (live.has(id)) continue;
      for (const c of d.overhead) c.destroy({ children: true });
      drawn.delete(id);
    }
    if (anyRedrawn) {
      for (const [key, m] of masks) {
        if (used.has(key)) continue;
        m.rt.destroy(true);
        masks.delete(key);
      }
      // Read by the e2e lane alongside the mask rebuild time.
      (globalThis as { __pathRedrawMs?: number }).__pathRedrawMs = performance.now() - started;
    }
  };
  onArrive = sync;
  sync();
  const unsub = useStore.subscribe(sync);
  return () => {
    unsub();
    onArrive = null;
    for (const m of masks.values()) m.rt.destroy(true);
    masks.clear();
    overhead.clear();
  };
}
