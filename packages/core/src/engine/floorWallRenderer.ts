import { Container, Graphics, Texture, TilingSprite } from 'pixi.js';
import type { DungeonLayer, ShapeChild } from '../store/types';
import type { LayerEntry } from './sceneGraph';
import type { Polygon } from '../types/geometry';
import { useStore } from '../store/store';
import * as textureLoader from '../assets/textureLoader';
import { resolveTexture } from '../assets/textureLoader';
import { preloadPathTextures } from './splineRenderer';
import { renderEdgeTransitions } from './edgeTransitions';
import { renderNodeWalls, type DoorGap } from './wallNodeRenderer';
import { renderDoors } from './doorRenderer';
import { rebuildWaterSublayer } from './water/waterRenderer';
import { resolveStyle } from './styleResolver';
import type { DungeonStyle } from '../store/types';
import { resolveDoors, resolveWalls, type ResolvedDoor } from '../shared/wallResolve';

function parseColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** Stone-gap openings for the doorways. A detached door has no wall to gap. */
function doorGapsFor(doors: ResolvedDoor[]): DoorGap[] {
  return doors
    .filter((d) => d.wall !== null)
    .map((d) => ({
      wallId: d.wall!.id,
      position: d.position,
      width: d.door.width,
      ring: d.wall!.ring,
    }));
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
  shape: ShapeChild,
  texture: Texture,
): void {
  const { minX, minY, maxX, maxY } = polygonBounds(shape.contours[0]);
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
  traceSinglePolygon(mask, shape.contours[0]);
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
  shape: ShapeChild,
  color: number,
): void {
  const g = new Graphics();
  traceSinglePolygon(g, shape.contours[0]);
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
  const wanted: string[] = [];
  for (const child of layer.children) {
    if (child.childType === 'shape' && child.textureId) {
      wanted.push(child.textureId);
    } else if (child.childType === 'water') {
      wanted.push(child.textureId);
      if (child.bankTextureId) wanted.push(child.bankTextureId);
    }
  }
  for (const id of wanted) {
    if (id && !id.includes(':') && !textureLoader.getSync(id)) {
      // Only preload bundled textures — pack textures are loaded at boot via rehydrate
      promises.push(
        textureLoader.load(id).catch((err: unknown) => {
          console.error(`[floorWall] texture load failed for "${id}":`, err);
        }),
      );
    }
  }
  promises.push(...preloadPathTextures(layer));
  if (promises.length === 0) return Promise.resolve(false);
  return Promise.all(promises).then(() => true);
}

/**
 * Redraw only the doors sublayer — for a door STATE flip (open/closed/locked,
 * isSecret, style) that leaves door geometry (position/width/wallId) alone.
 * Skips wall-stone re-layout and the Clipper2 floor union entirely: those
 * only need to run again when `withoutDoorGaps` (wallNodeRenderer.ts) would
 * cut different gaps, which is a geometry change, not a state change.
 */
export function redrawDoors(layer: DungeonLayer, entry: LayerEntry): void {
  if (!entry.sublayers) return;
  const { doors: doorsSublayer } = entry.sublayers;
  for (const child of doorsSublayer.removeChildren()) child.destroy();

  const resolvedWalls = resolveWalls(layer);
  const doors = resolveDoors(layer, resolvedWalls).filter((d) => d.door.visible);
  if (doors.length === 0) return;
  const gridCellSize = useStore.getState().grid.snapDivision || 1;
  renderDoors(doorsSublayer, doors, layer.style, gridCellSize);
}

/**
 * Redraw only the grid sublayer — for the grid visibility toggle, which moves
 * no geometry at all. Mirror of {@link redrawDoors}: no stone re-layout, no
 * Clipper2, no floor fill.
 *
 * Called from `rebuildDungeonLayer` too, so the two can never drift.
 */
export function redrawGrid(layer: DungeonLayer, entry: LayerEntry): void {
  if (!entry.sublayers) return;
  const gridSub = entry.sublayers.grid;
  for (const child of gridSub.removeChildren()) child.destroy();

  const polygons = layer.mergedFloor;
  if (!polygons || polygons.length === 0) return;
  if (!useStore.getState().grid.visible) return;

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
  const gridColor = parseColor(layer.style.wallColor);
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

/**
 * Rebuild a dungeon layer's sublayers from store state.
 * Called by subscribeToStore whenever shapes or walls change.
 *
 * Sublayer order (shadow → floor → grid → walls → paths) is
 * established in sceneGraph.addLayerToScene — we only populate content.
 */
export function rebuildDungeonLayer(layer: DungeonLayer, entry: LayerEntry): void {
  if (!entry.sublayers) return;

  const { floor, walls, doors: doorsSublayer } = entry.sublayers;

  // Clear all sublayers (reset floor mask from prior textured render)
  floor.mask = null;
  for (const child of floor.removeChildren()) child.destroy();
  // Not the walls: `renderNodeWalls` pools its stone sprites, reassigning the
  // ones already in the container and trimming the tail itself. Emptying it
  // here would throw the pool away on every rebuild, which is the allocation
  // this drag path exists to avoid.
  for (const child of doorsSublayer.removeChildren()) child.destroy();

  // paths sublayer removed in v2.0 model — spline paths are no longer separate

  // Water renders independently of floor geometry (a layer can be water-only)
  if (entry.sublayers.water) {
    rebuildWaterSublayer(entry.sublayers.water, layer);
  }

  // ── Walls and doors ────────────────────────────────────────────
  // Ahead of the no-floor bail-out below: walls do not depend on the floor
  // render, and a layer holding only standalone walls used to draw nothing at
  // all because this ran after that return. Z-order is unaffected — walls live
  // in their own sublayer container.
  // Doors resolve against every wall the engine knows about — standalone
  // segments and floor-ring edges alike — so a door on a floor edge draws and
  // gaps the stones exactly like one on a standalone wall, and both follow node
  // edits because their geometry is derived here rather than read off the child.
  const resolvedWalls = resolveWalls(layer);
  const doors = resolveDoors(layer, resolvedWalls).filter((d) => d.door.visible);
  renderNodeWalls(
    walls,
    layer.mergedFloor ?? [],
    layer.standaloneWalls,
    layer.style,
    doorGapsFor(doors),
    layer.floorWallEdits ?? {},
  );
  if (doors.length > 0) {
    const gridCellSize = useStore.getState().grid.snapDivision || 1;
    renderDoors(doorsSublayer, doors, layer.style, gridCellSize);
  }

  const polygons = layer.mergedFloor;
  if (!polygons || polygons.length === 0) return;

  const s = layer.style;
  const floorColorNum = parseColor(s.floorColor);

  // ── Floor fill (per-shape back-to-front) ─────────────────────
  // Render each shape individually: textured shapes get a TilingSprite
  // masked to their polygon; non-textured shapes get solid color fill.
  // A mergedFloor mask on the floor container clips everything to handle
  // erase holes automatically.

  const shapeChildren = layer.children.filter((c): c is ShapeChild => c.childType === 'shape');
  const hasTexturedShapes = shapeChildren.some((sh) => sh.textureId);

  // Fast-path detection: check if ANY shape has styleOverrides before
  // enabling per-shape resolution (avoids overhead in the common case).
  const hasStyleOverrides = shapeChildren.some((sh) => sh.styleOverrides && Object.keys(sh.styleOverrides).length > 0);

  if (hasTexturedShapes || hasStyleOverrides) {
    // Per-shape rendering: iterate back-to-front (array order = render order)
    for (const shape of shapeChildren) {
      if ((shape.contours[0]?.length ?? 0) < 3) continue;

      // Resolve per-shape style (fast-path: returns layerStyle reference if no overrides)
      const resolved: DungeonStyle = hasStyleOverrides
        ? resolveStyle(s, shape.styleOverrides as Partial<DungeonStyle> | undefined)
        : s;
      const shapeFloorColor = parseColor(resolved.floorColor);

      if (shape.textureId) {
        const texture = resolveTexture(shape.textureId);
        if (texture.width > 0) {
          renderTexturedShape(floor, shape, texture);
        } else {
          // Texture not loaded yet — fall back to solid tinted fill (guard NaN)
          const tint = shape.textureTint ? parseColor(shape.textureTint) : NaN;
          renderSolidShape(floor, shape, isNaN(tint) ? shapeFloorColor : tint);
        }
      } else {
        renderSolidShape(floor, shape, shapeFloorColor);
      }
    }

    // Clip the entire floor container to mergedFloor (handles erase holes)
    const floorMask = new Graphics();
    fillPolygonsWithHoles(floorMask, polygons, { color: 0xffffff });
    floor.addChild(floorMask);
    floor.mask = floorMask;
  } else {
    // No textured shapes, no style overrides — use original merged floor fill (faster)
    const floorG = new Graphics();
    fillPolygonsWithHoles(floorG, polygons, { color: floorColorNum });
    floor.addChild(floorG);
  }

  // ── Edge transitions (between differently-textured shapes) ───
  renderEdgeTransitions(floor, layer);

  // ── Grid sublayer (lines inside shapes) ─────────────────
  redrawGrid(layer, entry);

  // Walls and doors already rendered above, before the no-floor bail-out.

}
