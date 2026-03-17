import { Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import type { DungeonLayer, ShapeRecord } from '@/store/types';
import type { LayerEntry } from './sceneGraph';
import type { Polygon } from '@/types/geometry';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import { useStore } from '@/store/store';
import * as textureLoader from '@/assets/textureLoader';
import { rebuildPathsSublayer, preloadPathTextures } from './splineRenderer';
import { renderEdgeTransitions } from './edgeTransitions';
import { renderTexturedWalls } from './wallTextureRenderer';

function parseColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** Signed area of a polygon. Positive = CW in screen-space (outer), negative = CCW (hole). */
function signedArea(poly: Polygon): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i][0] * poly[j][1];
    area -= poly[j][0] * poly[i][1];
  }
  return area / 2;
}

function traceSinglePolygon(g: Graphics, polygon: Polygon): void {
  if (polygon.length < 3) return;
  g.moveTo(polygon[0][0], polygon[0][1]);
  for (let i = 1; i < polygon.length; i++) {
    g.lineTo(polygon[i][0], polygon[i][1]);
  }
  g.closePath();
}

function tracePolygons(g: Graphics, polygons: Polygon[]): void {
  for (const polygon of polygons) {
    traceSinglePolygon(g, polygon);
  }
}

/** Check if a point is inside a polygon (ray casting). */
function pointInPolygon(px: number, py: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Fill polygons with proper hole support for PixiJS v8.
 * Clipper2 returns outer contours (CW in screen-space, positive signed area)
 * and hole contours (CCW, negative signed area).
 *
 * PixiJS v8's cut() only cuts from the most recent fill(). When there are
 * multiple disconnected outers, we must fill+cut each outer with its own
 * holes individually — otherwise cut() can't associate holes with the
 * correct outer.
 */
function fillPolygonsWithHoles(g: Graphics, polygons: Polygon[], fillStyle: { color: number }): void {
  const outers: Polygon[] = [];
  const holes: Polygon[] = [];
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    if (signedArea(poly) >= 0) {
      outers.push(poly);
    } else {
      holes.push(poly);
    }
  }

  // If no holes, simple fill all outers at once
  if (holes.length === 0) {
    tracePolygons(g, outers);
    g.fill(fillStyle);
    return;
  }

  // Match each hole to its containing outer
  const outerHoles = new Map<number, Polygon[]>();
  for (let i = 0; i < outers.length; i++) {
    outerHoles.set(i, []);
  }
  for (const hole of holes) {
    // Use first point of hole to find which outer contains it
    const [hx, hy] = hole[0];
    for (let i = 0; i < outers.length; i++) {
      if (pointInPolygon(hx, hy, outers[i])) {
        outerHoles.get(i)!.push(hole);
        break;
      }
    }
  }

  // Fill each outer with its holes individually
  for (let i = 0; i < outers.length; i++) {
    const myHoles = outerHoles.get(i)!;
    traceSinglePolygon(g, outers[i]);
    g.fill(fillStyle);
    if (myHoles.length > 0) {
      for (const hole of myHoles) {
        traceSinglePolygon(g, hole);
      }
      g.cut();
    }
  }
}

/**
 * Draw parallel hatch lines across the bounding box of `polygons`.
 * Direction is determined by `angle` (radians), spaced `spacing` apart.
 */
function addHatchLines(g: Graphics, polygons: Polygon[], angle: number, spacing: number): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y] of polygon) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const r = Math.hypot(maxX - minX, maxY - minY) / 2 + 2;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Perpendicular direction for stepping between lines
  const steps = Math.ceil((r * 2) / spacing) + 2;
  for (let i = -steps; i <= steps; i++) {
    const px = cx + (-sin) * i * spacing;
    const py = cy + cos * i * spacing;
    g.moveTo(px - cos * r, py - sin * r);
    g.lineTo(px + cos * r, py + sin * r);
  }
}

/**
 * Compute axis-aligned bounding box of a polygon.
 */
function polygonBounds(points: [number, number][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Base scale factor: 200 texture pixels = 1 world unit (1 grid cell).
 * This is the FA standard — a 200×200px texture covers exactly 1 grid cell.
 * A 600px texture covers 3 grid cells at default textureScale=1.
 */
const PX_PER_GRID_CELL = 200;

/**
 * Render a single textured shape: TilingSprite masked to the shape polygon.
 * The TilingSprite is sized to the shape's bounding box and the texture
 * tiles seamlessly anchored to world origin.
 */
function renderTexturedShape(
  parent: Container,
  shape: ShapeRecord,
  texture: Texture,
): void {
  const { minX, minY, maxX, maxY } = polygonBounds(shape.points);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return;

  // Normalize tile scale: 200px = 1 grid cell, then apply user multiplier
  const userScale = shape.textureScale || 1;
  const tileScale = userScale / PX_PER_GRID_CELL;

  const ts = new TilingSprite({
    texture,
    width,
    height,
    tileScale: { x: tileScale, y: tileScale },
    tileRotation: shape.textureFillRotation,
  });
  ts.position.set(minX, minY);

  // Anchor tile pattern to world origin so adjacent shapes tile seamlessly
  const offsetX = shape.textureOffsetX ?? 0;
  const offsetY = shape.textureOffsetY ?? 0;
  ts.tilePosition.set(
    (-minX + offsetX) / tileScale,
    (-minY + offsetY) / tileScale,
  );

  // Apply tint (guard against undefined/invalid)
  if (shape.textureTint && shape.textureTint !== '#ffffff') {
    const tint = parseColor(shape.textureTint);
    if (!isNaN(tint)) ts.tint = tint;
  }

  // Mask to shape polygon (coordinates in world space, mask relative to parent)
  const mask = new Graphics();
  traceSinglePolygon(mask, shape.points);
  mask.fill({ color: 0xffffff });

  const container = new Container();
  container.addChild(ts);
  container.addChild(mask);
  container.mask = mask;
  parent.addChild(container);
}

/**
 * Render a single solid-color shape fill.
 */
function renderSolidShape(
  parent: Container,
  shape: ShapeRecord,
  color: number,
): void {
  const g = new Graphics();
  traceSinglePolygon(g, shape.points);
  g.fill({ color });
  parent.addChild(g);
}

/**
 * Preload textures for all textured shapes and paths in a layer.
 * Returns a Promise<boolean> that resolves to true if any NEW textures
 * were loaded (caller should re-rebuild the layer in that case).
 */
export function preloadLayerTextures(layer: DungeonLayer): Promise<boolean> {
  const promises: Promise<unknown>[] = [];
  for (const shape of layer.shapes) {
    if (shape.textureId && !textureLoader.getSync(shape.textureId)) {
      promises.push(textureLoader.load(shape.textureId).catch(() => {}));
    }
  }
  promises.push(...preloadPathTextures(layer));
  if (promises.length === 0) return Promise.resolve(false);
  return Promise.all(promises).then(() => true);
}

/**
 * Rebuild a dungeon layer's sublayers from store state.
 * Called by subscribeToStore whenever shapes or walls change.
 *
 * Sublayer order (shadow → floor → grid → hatching → walls → paths) is
 * established in sceneGraph.addLayerToScene — we only populate content.
 */
export function rebuildDungeonLayer(layer: DungeonLayer, entry: LayerEntry): void {
  if (!entry.sublayers) return;

  const { floor, hatching, walls } = entry.sublayers;

  // Clear all sublayers (reset floor mask from prior textured render)
  floor.mask = null;
  for (const child of floor.removeChildren()) child.destroy();
  for (const child of hatching.removeChildren()) child.destroy();
  for (const child of walls.removeChildren()) child.destroy();

  // Always rebuild paths sublayer — paths render independently of floor shapes
  rebuildPathsSublayer(layer, entry.sublayers.paths);

  const polygons = layer.mergedFloor;
  if (!polygons || polygons.length === 0) return;

  const s = layer.style;
  const floorColorNum = parseColor(s.floorColor);
  const wallColorNum  = parseColor(s.wallColor);

  // ── Floor fill (per-shape back-to-front) ─────────────────────
  // Render each shape individually: textured shapes get a TilingSprite
  // masked to their polygon; non-textured shapes get solid color fill.
  // A mergedFloor mask on the floor container clips everything to handle
  // erase holes automatically.

  const hasTexturedShapes = layer.shapes.some((sh) => sh.textureId);

  if (hasTexturedShapes) {
    // Per-shape rendering: iterate back-to-front (array order = render order)
    for (const shape of layer.shapes) {
      if (shape.points.length < 3) continue;

      if (shape.textureId) {
        const texture = textureLoader.getSync(shape.textureId);
        if (texture && texture.width > 0) {
          renderTexturedShape(floor, shape, texture);
        } else {
          // Texture not loaded yet — fall back to solid tinted fill (guard NaN)
          const tint = shape.textureTint ? parseColor(shape.textureTint) : NaN;
          renderSolidShape(floor, shape, isNaN(tint) ? floorColorNum : tint);
        }
      } else {
        renderSolidShape(floor, shape, floorColorNum);
      }
    }

    // Clip the entire floor container to mergedFloor (handles erase holes)
    const floorMask = new Graphics();
    fillPolygonsWithHoles(floorMask, polygons, { color: 0xffffff });
    floor.addChild(floorMask);
    floor.mask = floorMask;
  } else {
    // No textured shapes — use original merged floor fill (faster)
    const floorG = new Graphics();
    fillPolygonsWithHoles(floorG, polygons, { color: floorColorNum });
    floor.addChild(floorG);
  }

  // ── Edge transitions (between differently-textured shapes) ───
  renderEdgeTransitions(floor, layer);

  // ── Grid sublayer (lines inside shapes) ─────────────────
  {
    const gridSub = entry.sublayers.grid;
    for (const child of gridSub.removeChildren()) child.destroy();

    const gridState = useStore.getState().grid;
    if (gridState.visible) {
      // Compute bounding box of all floor polygons
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const polygon of polygons) {
        for (const [x, y] of polygon) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      const gridMinX = Math.floor(minX);
      const gridMaxX = Math.ceil(maxX);
      const gridMinY = Math.floor(minY);
      const gridMaxY = Math.ceil(maxY);

      // Mask to clip grid lines within floor shape
      const maskG = new Graphics();
      fillPolygonsWithHoles(maskG, polygons, { color: 0xffffff });

      // Grid lines
      const gridG = new Graphics();
      const gridColor = parseColor(s.wallColor);
      gridG.setStrokeStyle({ color: gridColor, width: 0.02, alpha: 0.25 });

      for (let x = gridMinX; x <= gridMaxX; x++) {
        gridG.moveTo(x, gridMinY);
        gridG.lineTo(x, gridMaxY);
      }
      for (let y = gridMinY; y <= gridMaxY; y++) {
        gridG.moveTo(gridMinX, y);
        gridG.lineTo(gridMaxX, y);
      }
      gridG.stroke();

      const gridContainer = new Container();
      gridContainer.addChild(maskG);
      gridContainer.addChild(gridG);
      gridContainer.mask = maskG;
      gridSub.addChild(gridContainer);
    }
  }

  // ── Hatching sublayer ────────────────────────────────────────
  if (s.hatchingStyle !== 'none') {
    const lineAngle = s.hatchingStyle === 'horizontal' ? 0 : s.hatchingAngle;

    // Determine hatch region: band = floor minus inflated-inward floor
    let hatchRegion: Polygon[];
    if (s.hatchingInverted) {
      // Fill entire floor interior
      hatchRegion = polygons;
    } else {
      // Fill border band: diff(floor, inward-inflate(floor, bandWidth))
      const inner = clipper2Engine.inflate(polygons, -s.hatchingBandWidth);
      hatchRegion = inner.length > 0
        ? clipper2Engine.difference(polygons, inner)
        : polygons;
    }

    // Mask Graphics — defines the hatch region
    const maskG = new Graphics();
    fillPolygonsWithHoles(maskG, hatchRegion, { color: 0xffffff });

    // Hatch lines Graphics
    const hatchG = new Graphics();
    hatchG.setStrokeStyle({ color: wallColorNum, width: s.hatchingLineThickness });
    addHatchLines(hatchG, polygons, lineAngle, s.hatchingLineSpacing);
    if (s.hatchingStyle === 'crosshatch') {
      addHatchLines(hatchG, polygons, lineAngle + Math.PI / 2, s.hatchingLineSpacing);
    }
    hatchG.stroke();

    // Wrap in a Container so mask applies to the lines only
    const hatchContainer = new Container();
    hatchContainer.addChild(maskG);
    hatchContainer.addChild(hatchG);
    hatchContainer.mask = maskG;
    hatching.addChild(hatchContainer);
  }

  // ── Walls (textured or invisible) ──────────────────────────────
  renderTexturedWalls(walls, polygons, layer.standaloneWalls, s);

}
