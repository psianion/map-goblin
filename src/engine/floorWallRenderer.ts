import { Container, Graphics } from 'pixi.js';
import type { DungeonLayer } from '@/store/types';
import type { LayerEntry } from './sceneGraph';
import type { Polygon } from '@/types/geometry';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import { useStore } from '@/store/store';

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
 * Rebuild a dungeon layer's sublayers from store state.
 * Called by subscribeToStore whenever shapes or walls change.
 *
 * Sublayer order (shadow → floor → grid → hatching → walls) is
 * established in sceneGraph.addLayerToScene — we only populate content.
 */
export function rebuildDungeonLayer(layer: DungeonLayer, entry: LayerEntry): void {
  if (!entry.sublayers) return;

  const { shadow, floor, hatching, walls } = entry.sublayers;

  // Clear all sublayers
  for (const child of shadow.removeChildren()) child.destroy();
  for (const child of floor.removeChildren()) child.destroy();
  for (const child of hatching.removeChildren()) child.destroy();
  for (const child of walls.removeChildren()) child.destroy();

  const polygons = layer.mergedFloor;
  if (!polygons || polygons.length === 0) return;

  const s = layer.style;
  const floorColorNum = parseColor(s.floorColor);
  const wallColorNum  = parseColor(s.wallColor);

  // ── Shadow sublayer ──────────────────────────────────────────
  if (s.shadowEnabled && s.shadowIntensity > 0) {
    const shadowG = new Graphics();
    shadowG.alpha = s.shadowIntensity;
    const ox = s.shadowOffset.x;
    const oy = s.shadowOffset.y;
    // Only offset outer contours for shadow; keep holes at original position
    // so shadow holes align with floor holes (otherwise shadow bleeds through
    // transparent floor holes because the shadow's offset hole doesn't cover them).
    const offsetPolygons: Polygon[] = polygons.map(poly => {
      if (poly.length < 3) return poly;
      const isHole = signedArea(poly) < 0;
      if (isHole) {
        // Hole stays at original position — aligns with floor hole
        return poly;
      }
      // Outer gets offset for shadow effect
      return poly.map(([x, y]) => [x + ox, y + oy] as [number, number]);
    });
    fillPolygonsWithHoles(shadowG, offsetPolygons, { color: parseColor(s.shadowColor) });
    shadow.addChild(shadowG);
  }

  // ── Floor fill ───────────────────────────────────────────────
  const floorG = new Graphics();
  fillPolygonsWithHoles(floorG, polygons, { color: floorColorNum });
  floor.addChild(floorG);

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

  // ── Wall outlines (stroke on floor boundary) ─────────────────
  // Only stroke outer contours — holes (negative signed area) should NOT get wall strokes.
  // When a selection is moved out, the difference operation creates hole contours that
  // would otherwise render as black rectangles inside the shape.
  const outerPolygons = polygons.filter(p => p.length >= 3 && signedArea(p) >= 0);
  const wallG = new Graphics();
  wallG.setStrokeStyle({ color: wallColorNum, width: s.wallWidth, join: 'round', cap: 'round' });
  tracePolygons(wallG, outerPolygons);
  wallG.stroke();
  walls.addChild(wallG);

  // ── Standalone walls ──────────────────────────────────────────
  for (const wall of layer.standaloneWalls) {
    if (wall.points.length < 2) continue;
    const wg = new Graphics();
    const wColor = parseColor(wall.color);
    wg.setStrokeStyle({ color: wColor, width: wall.width, join: 'round', cap: 'round' });
    wg.moveTo(wall.points[0][0], wall.points[0][1]);
    for (let i = 1; i < wall.points.length; i++) {
      wg.lineTo(wall.points[i][0], wall.points[i][1]);
    }
    wg.stroke();
    walls.addChild(wg);
  }
}
