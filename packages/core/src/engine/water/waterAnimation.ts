import { Container, DisplacementFilter, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';

/**
 * Shared water animation state: one displacement filter (ripple wobble)
 * applied to every water sublayer, plus tile-scroll flow on registered
 * water TilingSprites. Driven by a single ticker callback.
 */

interface FlowEntry {
  speed: number; // world units / second
  angle: number; // radians
}

let dispSprite: Sprite | null = null;
let filter: DisplacementFilter | null = null;
const flowSprites = new Map<TilingSprite, FlowEntry>();

/** Seamless-ish value noise: 64px noise upscaled+mirrored into 256px. */
function createNoiseTexture(): Texture {
  const small = document.createElement('canvas');
  small.width = 64;
  small.height = 64;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(64, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 96 + Math.random() * 64;
    img.data[i] = v;
    img.data[i + 1] = 128 + (Math.random() - 0.5) * 64;
    img.data[i + 2] = 128;
    img.data[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  // Mirror the smoothed noise into four quadrants so the texture wraps.
  ctx.drawImage(small, 0, 0, 128, 128);
  ctx.save(); ctx.translate(256, 0); ctx.scale(-1, 1); ctx.drawImage(small, 0, 0, 128, 128); ctx.restore();
  ctx.save(); ctx.translate(0, 256); ctx.scale(1, -1); ctx.drawImage(small, 0, 0, 128, 128); ctx.restore();
  ctx.save(); ctx.translate(256, 256); ctx.scale(-1, -1); ctx.drawImage(small, 0, 0, 128, 128); ctx.restore();

  const tex = Texture.from(canvas);
  tex.source.addressMode = 'repeat';
  return tex;
}

/** Create the displacement sprite + filter and start the ticker. Call once at engine boot. */
export function initWaterAnimation(engine: RenderEngine, worldContainer: Container): void {
  if (dispSprite) return;
  dispSprite = new Sprite(createNoiseTexture());
  dispSprite.renderable = false;
  dispSprite.label = 'waterDisplacement';
  // 256px texture spans ~8 world cells
  dispSprite.scale.set(8 / 256);
  worldContainer.addChild(dispSprite);

  filter = new DisplacementFilter({ sprite: dispSprite, scale: 10 });

  let t = 0;
  engine.addTickerCallback(() => {
    if (flowSprites.size === 0) return;
    const dt = engine.ticker().deltaMS / 1000;
    t += dt;
    // Slow drift of the displacement field = ripple wobble
    dispSprite!.position.set(Math.sin(t * 0.35) * 1.5 + t * 0.12, Math.cos(t * 0.28) * 1.5 + t * 0.08);
    // Tile-scroll each water surface along its flow direction
    for (const [ts, flow] of flowSprites) {
      if (flow.speed === 0) continue;
      ts.tilePosition.x += Math.cos(flow.angle) * flow.speed * dt;
      ts.tilePosition.y += Math.sin(flow.angle) * flow.speed * dt;
    }
  });
}

export function getWaterFilter(): DisplacementFilter | null {
  return filter;
}

export function registerFlowSprite(ts: TilingSprite, speed: number, angle: number): void {
  flowSprites.set(ts, { speed, angle });
}

/** Unregister every flow sprite that lives under the given container (pre-rebuild cleanup). */
export function unregisterFlowSpritesIn(root: Container): void {
  for (const ts of flowSprites.keys()) {
    let node: Container | null = ts;
    while (node) {
      if (node === root) {
        flowSprites.delete(ts);
        break;
      }
      node = node.parent;
    }
  }
}
