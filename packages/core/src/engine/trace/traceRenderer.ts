// Draws a background image layer (a trace) into its own layer container: one sprite of the
// picture, stretched to the map frame (Fit Map) or at the battlemap scale centred on it (Fit
// Original). The layer's opacity and visibility ride on the container like any layer's; the
// PNG export hides it (exportPipeline), and a publish drops it (shared/traceLayer.ts).

import { Assets, Sprite, type Texture } from 'pixi.js';
import type { ImageLayer } from '../../store/types';
import type { WorldBounds } from '../../shared/mapBounds';
import { getLayerEntry } from '../sceneGraph';

/**
 * Image pixels per grid square for a picture that arrives with its own printed grid: 70 is
 * Roll20's default cell and the most common figure published battlemaps are drawn at.
 */
export const BATTLEMAP_PX_PER_CELL = 70;

const SPRITE_LABEL = 'trace';

/** The picture each trace sprite was last asked to show, so a slow load never lands on a newer one. */
const wanted = new WeakMap<Sprite, string>();

/**
 * Where the picture sits, in cells, for an image `w` by `h` pixels and the map `frame`; an
 * Original fit with a `placement` sits exactly there.
 */
export function traceBox(
  fit: ImageLayer['fit'],
  frame: WorldBounds,
  w: number,
  h: number,
  placement?: ImageLayer['placement'],
): { x: number; y: number; width: number; height: number } {
  if (fit === 'map') return { x: frame.minX, y: frame.minY, width: frame.maxX - frame.minX, height: frame.maxY - frame.minY };
  if (placement) return { ...placement };
  const width = w / BATTLEMAP_PX_PER_CELL;
  const height = h / BATTLEMAP_PX_PER_CELL;
  return { x: (frame.minX + frame.maxX - width) / 2, y: (frame.minY + frame.maxY - height) / 2, width, height };
}

function cached(key: string): Texture | null {
  try {
    return Assets.cache.has(key) ? Assets.get<Texture>(key) : null;
  } catch {
    return null;
  }
}

/** Draws the trace `layer` showing the picture `src` (a data URL) over `frame`; no picture clears it. */
export function drawTraceLayer(layer: ImageLayer, src: string | undefined, frame: WorldBounds): void {
  const host = getLayerEntry(layer.id)?.container;
  if (!host) return;
  if (!src) {
    for (const child of host.removeChildren()) child.destroy();
    return;
  }
  let sprite = host.children.find((c) => c.label === SPRITE_LABEL) as Sprite | undefined;
  if (!sprite) {
    sprite = new Sprite();
    sprite.label = SPRITE_LABEL;
    host.addChild(sprite);
  }
  const target = sprite;
  wanted.set(target, layer.imageKey);
  const place = (tex: Texture) => {
    target.texture = tex;
    target.visible = true;
    const b = traceBox(layer.fit, frame, tex.width, tex.height, layer.placement);
    target.position.set(b.x, b.y);
    target.width = b.width;
    target.height = b.height;
  };
  const tex = cached(layer.imageKey);
  if (tex) {
    place(tex);
    return;
  }
  target.visible = false;
  void Assets.load<Texture>({ alias: layer.imageKey, src })
    .then((loaded) => {
      if (!target.destroyed && wanted.get(target) === layer.imageKey) place(loaded);
    })
    .catch((err: unknown) => console.warn('[trace] could not load', layer.fileName, err));
}
