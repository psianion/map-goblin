import { Container, Graphics, TilingSprite } from 'pixi.js';
import type { DungeonLayer } from '../../store/types';
import type { WaterChild } from '../../shared/types';
import type { Polygon } from '../../types/geometry';
import { resolveTexture } from '../../assets/textureLoader';
import { registerFlowSprite, unregisterFlowSpritesIn } from './waterAnimation';

const PX_PER_GRID_CELL = 200;
const MIN_BANK_EDGE = 0.05;

function parseColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function polygonBounds(poly: Polygon) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
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

  const texture = resolveTexture(water.textureId);
  const { minX, minY, maxX, maxY } = polygonBounds(outer);
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

  // Mask: outer contour minus holes
  const mask = new Graphics();
  tracePolygon(mask, outer);
  mask.fill({ color: 0xffffff });
  if (water.contours.length > 1) {
    for (let i = 1; i < water.contours.length; i++) {
      tracePolygon(mask, water.contours[i]);
    }
    mask.cut();
  }

  body.addChild(ts);
  body.addChild(mask);
  body.mask = mask;
  parent.addChild(body);

  registerFlowSprite(ts, water.flowSpeed ?? 0, water.flowAngle ?? 0);

  // ── Bank strips along the outer shoreline ──
  if (water.bankTextureId) {
    const bankTex = resolveTexture(water.bankTextureId);
    if (bankTex.width > 1) {
      const banks = new Container();
      banks.label = 'water-banks';
      const bankWidth = water.bankWidth || 0.5;
      const bankScale = bankWidth / bankTex.height;
      let accum = 0;
      for (let i = 0; i < outer.length; i++) {
        const [x1, y1] = outer[i];
        const [x2, y2] = outer[(i + 1) % outer.length];
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
      // ponytail: per-edge strips, no corner mitering — dense spline contours hide the joints
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
