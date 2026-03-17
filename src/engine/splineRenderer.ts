/**
 * Renders spline paths on dungeon layers.
 *
 * Each SplinePathRecord is interpolated via Catmull-Rom, expanded into
 * a polygon via generatePathPolygon, then rendered as either a
 * polygon-masked TilingSprite (if textured) or a solid Graphics fill.
 */

import { Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import type { SplinePathRecord, DungeonLayer } from '@/store/types';
import { interpolateCatmullRom, generatePathPolygon } from '@/geometry/catmullRom';
import * as textureLoader from '@/assets/textureLoader';

function parseColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** Default half-width for path rendering (in world units / grid cells). */
const DEFAULT_PATH_HALF_WIDTH = 0.5;

/**
 * Render a single spline path into the given container.
 */
function renderSplinePath(parent: Container, path: SplinePathRecord): void {
  if (path.controlPoints.length < 2) return;

  // Interpolate the spline
  const interpolated = interpolateCatmullRom(path.controlPoints, 16, 0.5);
  if (interpolated.length < 2) return;

  // Generate the path outline polygon with uniform width
  const widths = [DEFAULT_PATH_HALF_WIDTH];
  const polygon = generatePathPolygon(interpolated, widths);
  if (polygon.length < 3) return;

  if (path.textureId) {
    const texture = textureLoader.getSync(path.textureId);
    if (texture && texture.width > 0) {
      renderTexturedPath(parent, path, polygon, texture);
      return;
    }
  }

  // Solid color fallback (guard against undefined/invalid tint)
  const g = new Graphics();
  g.moveTo(polygon[0][0], polygon[0][1]);
  for (let i = 1; i < polygon.length; i++) {
    g.lineTo(polygon[i][0], polygon[i][1]);
  }
  g.closePath();
  const tint = path.textureTint ? parseColor(path.textureTint) : NaN;
  g.fill({ color: isNaN(tint) ? 0x888888 : tint });
  parent.addChild(g);
}

/**
 * Render a textured path: TilingSprite masked to the path polygon.
 */
function renderTexturedPath(
  parent: Container,
  path: SplinePathRecord,
  polygon: [number, number][],
  texture: Texture,
): void {
  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return;

  // Normalize tile scale: 200px = 1 grid cell (FA standard)
  const PX_PER_GRID_CELL = 200;
  const userScale = path.textureScale || 1;
  const tileScale = userScale / PX_PER_GRID_CELL;

  const ts = new TilingSprite({
    texture,
    width,
    height,
    tileScale: { x: tileScale, y: tileScale },
  });
  ts.position.set(minX, minY);
  // Anchor to world origin for seamless tiling
  ts.tilePosition.set(-minX / tileScale, -minY / tileScale);

  if (path.textureTint && path.textureTint !== '#ffffff') {
    ts.tint = parseColor(path.textureTint);
  }

  // Mask to path polygon
  const mask = new Graphics();
  mask.moveTo(polygon[0][0], polygon[0][1]);
  for (let i = 1; i < polygon.length; i++) {
    mask.lineTo(polygon[i][0], polygon[i][1]);
  }
  mask.closePath();
  mask.fill({ color: 0xffffff });

  const container = new Container();
  container.addChild(ts);
  container.addChild(mask);
  container.mask = mask;
  parent.addChild(container);
}

/**
 * Rebuild the paths sublayer for a dungeon layer.
 * Called from rebuildDungeonLayer.
 */
export function rebuildPathsSublayer(layer: DungeonLayer, pathsContainer: Container): void {
  // Clear previous
  pathsContainer.mask = null;
  for (const child of pathsContainer.removeChildren()) child.destroy();

  if (!layer.paths || layer.paths.length === 0) return;

  for (const path of layer.paths) {
    renderSplinePath(pathsContainer, path);
  }
}

/**
 * Collect texture load promises for spline paths.
 * Returns an array of promises for any textures not yet cached.
 */
export function preloadPathTextures(layer: DungeonLayer): Promise<unknown>[] {
  if (!layer.paths) return [];
  const promises: Promise<unknown>[] = [];
  for (const path of layer.paths) {
    if (path.textureId && !textureLoader.getSync(path.textureId)) {
      promises.push(textureLoader.load(path.textureId).catch(() => {}));
    }
  }
  return promises;
}
