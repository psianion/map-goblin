// Junction blending: the paths of one (layer, material, sort, edge) group share one soft
// outline. Their ribbons are drawn solid white into a render texture cropped to the group's
// bounds and blurred; the ribbon shader then reads that mask, thresholded at its middle, as
// the alpha of every ribbon in the group. Overlapping roads become one surface with one
// feathered outline and no edge fading over another road. Rebuilt only when the group's
// signature changes.

import { BlurFilter, Container, Graphics, RenderTexture, type TextureSource } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import type { RibbonMesh } from '../../geometry/ribbon';

/** Mask pixels per cell, at most; a big group drops toward `MIN_PX_PER_CELL` to fit the cap. */
export const MASK_PX_PER_CELL = 32;
export const MIN_PX_PER_CELL = 4;
export const MASK_MAX_PX = 4096;

export interface GroupMask {
  signature: string;
  rt: RenderTexture;
  rect: { x: number; y: number; width: number; height: number };
  source: TextureSource;
}

/** Bounds of every ribbon in the group, grown by `pad` cells. */
export function groupBounds(meshes: readonly RibbonMesh[], pad: number): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of meshes) {
    for (let i = 0; i < m.positions.length; i += 2) {
      const x = m.positions[i];
      const y = m.positions[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/** Pixels per cell for a rect: the default, lowered until the longer side fits the cap. */
export function maskResolution(rect: { width: number; height: number }): number {
  const longest = Math.max(rect.width, rect.height, 1e-6);
  return Math.max(MIN_PX_PER_CELL, Math.min(MASK_PX_PER_CELL, MASK_MAX_PX / longest));
}

/** Fill every triangle of a ribbon: its exact coverage, folds and caps included. */
function fillTriangles(g: Graphics, m: RibbonMesh): void {
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 2;
    const b = m.indices[t + 1] * 2;
    const c = m.indices[t + 2] * 2;
    g.poly([p[a], p[a + 1], p[b], p[b + 1], p[c], p[c + 1]]);
  }
  g.fill({ color: 0xffffff });
}

let lastRebuildMs = 0;
/** How long the last mask rebuild took, ms (for the step's measurement and the e2e probe). */
export function lastMaskRebuildMs(): number {
  return lastRebuildMs;
}

/**
 * The group's mask, reused while `signature` holds, else rebuilt into a new render texture
 * (the old one destroyed). `edgeWidth` is the feather, cells. Null when nothing to draw.
 */
export function groupMask(
  engine: RenderEngine,
  previous: GroupMask | undefined,
  signature: string,
  meshes: readonly RibbonMesh[],
  edgeWidth: number,
): GroupMask | null {
  if (previous && previous.signature === signature) return previous;
  const started = performance.now();
  previous?.rt.destroy(true);
  const rect = groupBounds(meshes, edgeWidth * 2);
  if (!rect) return null;
  const res = maskResolution(rect);
  const w = Math.max(1, Math.ceil(rect.width * res));
  const h = Math.max(1, Math.ceil(rect.height * res));
  const rt = RenderTexture.create({ width: w, height: h, resolution: 1 });
  const g = new Graphics();
  for (const m of meshes) fillTriangles(g, m);
  g.scale.set(res);
  g.position.set(-rect.x * res, -rect.y * res);
  // The blur straddles the true edge: half its spread outside, half in. The shader keeps
  // the inner half (smoothstep from the midpoint), so the feather sits inside the ribbon.
  g.filters = [new BlurFilter({ strength: Math.max(1, edgeWidth * res * 0.5), quality: 3 })];
  const holder = new Container();
  holder.addChild(g);
  engine.renderToTexture(holder, rt, true);
  holder.destroy({ children: true });
  lastRebuildMs = performance.now() - started;
  // Read by the e2e lane, which measures a rebuild on a busy map.
  (globalThis as { __pathMaskRebuildMs?: number }).__pathMaskRebuildMs = lastRebuildMs;
  // The rect in world units matches the texture exactly (rounded up to whole pixels).
  return { signature, rt, source: rt.source, rect: { x: rect.x, y: rect.y, width: w / res, height: h / res } };
}
