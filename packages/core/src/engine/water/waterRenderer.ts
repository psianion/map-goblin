import { Container, Graphics, TilingSprite } from 'pixi.js';
import type { DungeonLayer } from '../../store/types';
import type { WaterChild } from '../../shared/types';
import type { Polygon } from '../../types/geometry';
import { unitTexture } from '../../assets/textureLoader';
import { registerFlowSprite, unregisterFlowSpritesIn } from './waterAnimation';

const PX_PER_GRID_CELL = 200;
const MIN_BANK_EDGE = 0.05;
/** cos(~2.5°) — edges straighter than this join into one bank strip. */
const COLINEAR_DOT = 0.999;

function parseColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function polygonsBounds(polys: Polygon[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Twice the signed area — sign gives the winding direction. */
function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

/**
 * Collapse consecutive near-colinear edges into single segments. Clipper's
 * round joins emit dozens of tiny edges per corner and each one would
 * otherwise become its own bank TilingSprite (and its own draw call).
 */
function mergedEdges(poly: Polygon): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const n = poly.length;
  let sx = poly[0][0], sy = poly[0][1];
  let px = sx, py = sy;
  for (let i = 1; i <= n; i++) {
    const [cx, cy] = poly[i % n];
    const ax = px - sx, ay = py - sy;
    const bx = cx - px, by = cy - py;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    // Break the run where the direction turns by more than ~2.5°
    if (la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) < COLINEAR_DOT) {
      out.push([sx, sy, px, py]);
      sx = px; sy = py;
    }
    px = cx; py = cy;
  }
  out.push([sx, sy, px, py]);
  return out;
}

function tracePolygon(g: Graphics, poly: Polygon): void {
  if (poly.length < 3) return;
  g.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
  g.closePath();
}

/**
 * Render one water body: animated TilingSprite masked to the polygon,
 * plus bank edge strips tiled along the outer shoreline.
 */
function renderWaterChild(parent: Container, water: WaterChild): void {
  const outer = water.contours[0];
  if (!outer || outer.length < 3) return;

  // unitTexture, not resolveTexture: a variant-sheet source file must fill with
  // just its one unit, matching the palette/brush/floor-fill scale.
  const texture = unitTexture(water.textureId).texture;
  // A 1x1 magenta placeholder means the id can't be resolved — tiling that
  // would paint the whole body solid magenta.
  if (texture.width <= 1) return;

  // Clipper can return several same-winding rings for one self-crossing stroke;
  // only the opposite-winding ones are holes to cut out of the body.
  const outerSign = Math.sign(signedArea(outer));
  const rings = water.contours.filter((c) => c.length >= 3);
  const fills = rings.filter((c, i) => i === 0 || Math.sign(signedArea(c)) === outerSign);
  const holes = rings.filter((c, i) => i > 0 && Math.sign(signedArea(c)) !== outerSign);

  const { minX, minY, maxX, maxY } = polygonsBounds(fills);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return;

  const body = new Container();
  body.label = `water-${water.id}`;

  const tileScale = 1 / PX_PER_GRID_CELL;
  const ts = new TilingSprite({
    texture,
    width,
    height,
    tileScale: { x: tileScale, y: tileScale },
  });
  ts.position.set(minX, minY);
  // Anchor pattern to world origin so adjacent water bodies tile seamlessly
  ts.tilePosition.set(-minX, -minY);
  if (water.tint && water.tint !== '#ffffff') {
    const tint = parseColor(water.tint);
    if (!isNaN(tint)) ts.tint = tint;
  }
  ts.alpha = water.opacity ?? 1;

  // Mask: filled rings minus holes
  const mask = new Graphics();
  for (const ring of fills) tracePolygon(mask, ring);
  mask.fill({ color: 0xffffff });
  if (holes.length > 0) {
    for (const hole of holes) tracePolygon(mask, hole);
    mask.cut();
  }

  body.addChild(ts);
  body.addChild(mask);
  body.mask = mask;
  parent.addChild(body);

  registerFlowSprite(ts, water.flowSpeed ?? 0, water.flowAngle ?? 0);

  // ── Bank strips along the outer shoreline ──
  if (water.bankTextureId) {
    const bankTex = unitTexture(water.bankTextureId).texture;
    if (bankTex.width > 1) {
      const banks = new Container();
      banks.label = 'water-banks';
      const bankWidth = water.bankWidth || 0.5;
      const bankScale = bankWidth / bankTex.height;
      for (const ring of fills) {
        let accum = 0;
        for (const [x1, y1, x2, y2] of mergedEdges(ring)) {
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy);
          if (len < MIN_BANK_EDGE) { accum += len; continue; }

          const strip = new TilingSprite({
            texture: bankTex,
            width: len,
            height: bankWidth,
            tileScale: { x: bankScale, y: bankScale },
          });
          strip.position.set(x1, y1);
          strip.rotation = Math.atan2(dy, dx);
          // Continuous pattern across polygon edges
          strip.tilePosition.x = -accum;
          banks.addChild(strip);
          accum += len;
        }
      }
      // ponytail: merged straight runs, no corner mitering — dense spline
      // contours hide the joints; miter the corners if seams ever show
      parent.addChild(banks);
    }
  }
}

/**
 * Rebuild a layer's water sublayer. Called from rebuildDungeonLayer.
 */
export function rebuildWaterSublayer(waterContainer: Container, layer: DungeonLayer): void {
  unregisterFlowSpritesIn(waterContainer);
  waterContainer.mask = null;
  for (const child of waterContainer.removeChildren()) child.destroy({ children: true });

  const waterChildren = layer.children.filter(
    (c): c is WaterChild => c.childType === 'water' && c.visible,
  );
  for (const water of waterChildren) {
    renderWaterChild(waterContainer, water);
  }
}
