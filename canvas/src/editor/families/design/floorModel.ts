// What the floor card's fields read: the picked floors and a floor's texture fill.

import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import type { MapBuilderStore, ShapeChild } from '@/store/types';
import { radToDeg } from '@/editor/models/selectionModel';

export const state = () => useStore.getState() as MapBuilderStore;

/** The picked floors, for a field whose write reaches only some of them. */
export function pickedFloors(ids: readonly string[]): ShapeChild[] {
  const out: ShapeChild[] = [];
  for (const id of ids) {
    const c = selectLayerForChild(state(), id)?.children.find((x) => x.id === id);
    if (c?.childType === 'shape') out.push(c);
  }
  return out;
}

export interface FillValue {
  scale: number;
  /** Degrees, 0 to 360. */
  rotate: number;
  x: number;
  y: number;
}

export function fillOf(o: ShapeChild): FillValue {
  return { scale: o.textureScale, rotate: Math.round(radToDeg(o.textureFillRotation)), x: o.textureOffsetX, y: o.textureOffsetY };
}
