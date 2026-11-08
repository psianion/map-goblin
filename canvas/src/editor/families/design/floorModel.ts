// What the floor card's fields read: the picked floors, a floor's texture fill and the
// edge band it draws with.

import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import { isBandSet } from '@dnd/core/src/assets/packCatalog';
import type { DungeonLayer, MapBuilderStore, ShapeChild } from '@/store/types';
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

/** The band a layer draws its floors' edges with, or null when its walls are not a band. */
export function layerBandOf(layer: Pick<DungeonLayer, 'style'> | null | undefined): string | null {
  const id = layer?.style.wallTextureSetId;
  return id && isBandSet(id) ? id : null;
}

/** A floor's edge band as it draws: its own, else its layer's. */
export function edgeBandOf(o: ShapeChild): string | null {
  if (o.edgeBand !== undefined) return o.edgeBand;
  const layer = selectLayerForChild(state(), o.id);
  return layerBandOf(layer?.type === 'dungeon' ? (layer as DungeonLayer) : null);
}

export function fillOf(o: ShapeChild): FillValue {
  return { scale: o.textureScale, rotate: Math.round(radToDeg(o.textureFillRotation)), x: o.textureOffsetX, y: o.textureOffsetY };
}
