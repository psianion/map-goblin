// The map's frame as the tools and the ground read it: where a size-locked map ends (tools
// stop there, and nothing past it is drawn or picked), and where the base ground lies.

import { useStore } from '../store/store';
import type { Polygon } from '../types/geometry';
import { computeMapFrame, type WorldBounds } from '../shared/mapBounds';
import { baseGroundOf, frameRing, inFrame, lockedFrame } from '../shared/pieces';
import { levelOf } from '../shared/lookScope';
import { clipper2Engine, isClipperReady } from '../geometry/Clipper2Engine';
import { notify } from '../shared/notify';

/** The map's frame as the store holds it now; null while nothing is drawn on a map with no size. */
export function mapFrameNow(): WorldBounds | null {
  const s = useStore.getState();
  return computeMapFrame(s.layers, s.mapSettings.terrain?.bounds ?? null, s.mapSettings.fixedSize ?? null);
}

/** The frame tools stop at: a size-locked map's. Null on a map that grows as it is drawn. */
export function toolFrame(): WorldBounds | null {
  return lockedFrame(useStore.getState().mapSettings);
}

/**
 * Where the base ground lies under a layer: the map's frame, when the layer's level has a
 * ground (its own, else the map's). Null with no ground. It is ground to stand on: plateaus
 * and props accept it everywhere inside.
 */
export function baseGroundFrame(layer: { levelId: string }): WorldBounds | null {
  const s = useStore.getState();
  if (!baseGroundOf(s.mapSettings, levelOf(s.levels, layer))) return null;
  return mapFrameNow();
}

/** Whether a point tool may place at a point: anywhere on a map that grows, on the frame of a sized one. */
export function onMap(x: number, y: number): boolean {
  const frame = toolFrame();
  return !frame || inFrame(frame, x, y);
}

/** The refusal a point tool shows when a click lands off a sized map. */
export function warnOffMap(): void {
  notify.subtle('Outside the map · resize it in Map settings');
}

/** `rings` cut to a sized map's frame; as they are on a map that grows, or before Clipper is loaded. */
export function cutToFrame(rings: Polygon[]): Polygon[] {
  const frame = toolFrame();
  if (!frame || rings.length === 0 || !isClipperReady()) return rings;
  const box = ringsBox(rings);
  if (box.minX >= frame.minX && box.minY >= frame.minY && box.maxX <= frame.maxX && box.maxY <= frame.maxY) return rings;
  return clipper2Engine.intersection(rings, [frameRing(frame)]);
}

function ringsBox(rings: readonly Polygon[]): WorldBounds {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const ring of rings) {
    for (const [x, y] of ring) {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  return box;
}
