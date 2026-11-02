// Paths on the canvas, for now as flat-coloured ribbons: the ribbon mesh's outline filled
// with the material's colour, the edge strips a paler band beside it, a filled lake's
// interior a deeper tone under them. Enough to draw, pick and export paths while the
// textured renderer (strip, soft edge, fades, junctions) is built.

import { Container, Graphics } from 'pixi.js';
import { useStore } from '../store/store';
import { getLayerEntry } from './sceneGraph';
import { pathCentreline } from '../geometry/pathGeometry';
import { buildEdgeStrips, buildRibbonMesh, type RibbonMesh } from '../geometry/ribbon';
import { pathMaterial } from '../assets/packCatalog';
import type { PathChild } from '../shared/types';

/** The placeholder materials' average colours; anything else draws grey. */
const MATERIAL_COLOUR: Record<string, number> = {
  'road-dirt': 0x8b6b4a,
  'road-cobble': 0x8a8882,
  'trail-grass': 0x7f8f5a,
  planks: 0x9a7346,
  water: 0x5d8fa8,
};
const FALLBACK_COLOUR = 0x8a8a8a;
/** The edge strip's width when a material has one, cells. */
export const EDGE_STRIP_WIDTH = 0.5;

function parseHex(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

function multiply(a: number, b: number, k = 1): number {
  const ch = (shift: number) => Math.min(255, Math.round((((a >> shift) & 0xff) * ((b >> shift) & 0xff) * k) / 255));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The flat colour a path draws in: its material's, times its tint. */
export function pathColour(path: PathChild): number {
  const set = path.materialId.slice(path.materialId.indexOf(':') + 1);
  return multiply(MATERIAL_COLOUR[set] ?? FALLBACK_COLOUR, parseHex(path.tint));
}

/** A strip as one polygon: its first side forward, its second back. */
function stripOutline(mesh: RibbonMesh): number[] {
  const p = mesh.positions;
  const n = p.length / 4;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(p[i * 4], p[i * 4 + 1]);
  for (let i = n - 1; i >= 0; i--) out.push(p[i * 4 + 2], p[i * 4 + 3]);
  return out;
}

function drawPath(g: Graphics, path: PathChild): void {
  const line = pathCentreline(path);
  if (line.xy.length < 2) return;
  const colour = pathColour(path);
  const alpha = path.opacity;
  if (path.closed && path.fill) {
    g.poly(line.xy.slice(0, -1).flat()).fill({ color: multiply(colour, 0xffffff, 0.8), alpha });
  }
  if (path.edgeStrip && pathMaterial(path.materialId)?.pieces.edge) {
    const { left, right } = buildEdgeStrips(line, EDGE_STRIP_WIDTH);
    for (const strip of [left, right]) {
      if (strip.positions.length >= 8) g.poly(stripOutline(strip)).fill({ color: colour, alpha: alpha * 0.4 });
    }
  }
  const mesh = buildRibbonMesh(line, { ends: path.ends, offset: path.offset });
  if (mesh.positions.length >= 8) g.poly(stripOutline(mesh)).fill({ color: colour, alpha });
}

/** Redraws one layer's paths into its `paths` sublayer, in child order. */
export function renderPaths(container: Container, paths: readonly PathChild[]): void {
  for (const c of container.removeChildren()) c.destroy();
  const g = new Graphics();
  g.label = 'paths';
  for (const path of paths) if (path.visible) drawPath(g, path);
  container.addChild(g);
}

/**
 * Keeps every dungeon layer's `paths` sublayer in step with its path children. A layer is
 * redrawn when its paths change (the store hands back new child objects on any edit) or
 * when its scene entry is a new one.
 */
export function subscribeToPaths(): () => void {
  const drawn = new Map<string, { container: Container; paths: PathChild[] }>();
  const sync = () => {
    const live = new Set<string>();
    for (const layer of useStore.getState().layers) {
      if (layer.type !== 'dungeon') continue;
      live.add(layer.id);
      const container = getLayerEntry(layer.id)?.sublayers?.paths;
      if (!container) continue;
      const paths = layer.children.filter((c): c is PathChild => c.childType === 'path');
      const prev = drawn.get(layer.id);
      if (prev && prev.container === container && prev.paths.length === paths.length && prev.paths.every((p, i) => p === paths[i])) {
        continue;
      }
      renderPaths(container, paths);
      drawn.set(layer.id, { container, paths });
    }
    for (const id of drawn.keys()) if (!live.has(id)) drawn.delete(id);
  };
  sync();
  return useStore.subscribe(sync);
}
