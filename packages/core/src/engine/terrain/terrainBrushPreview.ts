import { Graphics, Matrix } from 'pixi.js';
import { resolveTexture } from '../../assets/textureLoader';
import { useStore } from '../../store/store';
import { DEFAULT_TERRAIN_PALETTE } from '../../store/slices/mapSettings';

/** Texture pixels per grid cell — the scale the splat shader tiles at. */
const PX_PER_CELL = 200;

/** The texture a brush slot would paint, or null for an empty slot. */
export function terrainSlotTexture(slot: number): string | null {
  const palette = useStore.getState().mapSettings.terrain?.palette ?? DEFAULT_TERRAIN_PALETTE;
  return palette[slot] ?? null;
}

/**
 * The disc a stroke would lay down: the slot's own texture, tiled at paint scale
 * and anchored to the world origin exactly like the splat shader, so the brush
 * shows its material and its size instead of an outline you have to guess at.
 *
 * Erase has nothing to show, so it stays a flat red disc.
 */
export function drawTerrainBrushDisc(
  g: Graphics,
  cx: number,
  cy: number,
  radius: number,
  slot: number,
  erase: boolean,
  alpha: number,
  strokeWidth: number,
  strokeColor?: number,
): void {
  const color = erase ? 0xff4444 : 0x4a9eff;
  const id = erase ? null : terrainSlotTexture(slot);
  const texture = id ? resolveTexture(id) : null;

  g.circle(cx, cy, radius);
  if (texture && texture.width > 1) {
    g.fill({ texture, matrix: new Matrix().scale(1 / PX_PER_CELL, 1 / PX_PER_CELL), alpha });
  } else {
    g.fill({ color, alpha: alpha * 0.25 });
  }
  g.circle(cx, cy, radius);
  g.stroke({ width: strokeWidth, color: strokeColor ?? color, alpha: 0.7 });
}
