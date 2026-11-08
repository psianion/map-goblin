// Draws a layer's water into its water sublayer: one sprite over the mask's texel grid,
// coloured by shared/waterMask's waterPixels and filtered smooth when scaled to the map.
// The PNG export renders the same sprite, since it draws the world container.

import { Sprite, Texture } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { DungeonLayer } from '../../store/types';
import { getLayerEntry } from '../sceneGraph';
import { decodeWater, WATER_TEXELS_PER_CELL, waterPixels, type WaterGrid, type WaterLook } from '../../shared/waterMask';

const SPRITE_LABEL = 'water';

function clear(host: Container): void {
  for (const child of host.removeChildren()) {
    const sprite = child as Sprite;
    const tex = sprite.texture;
    sprite.destroy();
    if (tex && tex !== Texture.EMPTY) tex.destroy(true);
  }
}

/** Draws `grid` in `look` into `host`, replacing what was there; an empty grid clears it. */
export function drawWaterGrid(host: Container, grid: WaterGrid, look: WaterLook): void {
  clear(host);
  if (grid.w <= 0 || grid.h <= 0 || typeof document === 'undefined') return;
  const { width, height, pixels } = waterPixels(grid, look);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  const sprite = new Sprite(Texture.from(canvas));
  sprite.label = SPRITE_LABEL;
  // One texel of margin round the grid (waterPixels), so the sprite starts a texel early.
  sprite.position.set((grid.x - 1) / WATER_TEXELS_PER_CELL, (grid.y - 1) / WATER_TEXELS_PER_CELL);
  sprite.scale.set(1 / WATER_TEXELS_PER_CELL);
  host.addChild(sprite);
}

/** Draws a layer's saved water, or clears it when the layer is dry. */
export function drawLayerWater(layer: DungeonLayer): void {
  const host = getLayerEntry(layer.id)?.sublayers?.water;
  if (!host) return;
  drawWaterGrid(host, decodeWater(layer.water), layer.water ?? { shallow: '#000000', deep: '#000000', blend: 0, border: false });
}

/** The Water brush's live stroke: the layer's water as it is being painted. */
export function previewLayerWater(layerId: string, grid: WaterGrid, look: WaterLook): void {
  const host = getLayerEntry(layerId)?.sublayers?.water;
  if (host) drawWaterGrid(host, grid, look);
}
