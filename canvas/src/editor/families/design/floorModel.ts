// What the floor card's fields read: the picked floors, a floor's texture fill and the
// edge band it draws with.

import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import { isBandSet } from '@dnd/core/src/assets/packCatalog';
import type { DungeonLayer, MapBuilderStore, ShapeChild } from '@/store/types';
import { radToDeg } from '@/editor/models/selectionModel';
import { floorWallSet, roomsOverridingFloor, type FloorWallKey } from '@dnd/core/src/shared/wallLook';
import { blockedLayerReason } from '@dnd/core/src/engine/tools/layerGuard';
import { SetRoomLookCommand } from '@/store/commands';
import type { Command } from '@/store/types';
import { layerDrawStyle } from '@dnd/core/src/engine/levelLook';

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

/** The set a walled floor's outline is drawn with, as the renderer reads it: '' for none. */
export function drawnWallSetOf(o: ShapeChild): string {
  const layer = selectLayerForChild(state(), o.id);
  if (layer?.type !== 'dungeon') return '';
  return floorWallSet(o, layerDrawStyle(layer as DungeonLayer));
}

/** A floor's edge band as it draws: its own, else its pinned set's or its layer's when that is a band. */
export function edgeBandOf(o: ShapeChild): string | null {
  if (o.edgeBand !== undefined) return o.edgeBand;
  const set = drawnWallSetOf(o);
  return set && isBandSet(set) ? set : null;
}

/**
 * For a wall pick on the picked floors to show: clearing the own pin of `key` on each room
 * whose pin draws over one of those floors' own edges (`roomsOverridingFloor`). A pin that
 * comes from the room's area stays. Rooms on a locked layer are left alone, as the floor is.
 */
export function roomPinsOver(ids: readonly string[], key: FloorWallKey): Command[] {
  const st = state();
  const seen = new Set<string>();
  const out: Command[] = [];
  for (const id of ids) {
    const layer = selectLayerForChild(st, id);
    if (layer?.type !== 'dungeon' || blockedLayerReason(layer)) continue;
    for (const roomId of roomsOverridingFloor(layer as DungeonLayer, id, key)) {
      if (seen.has(`${layer.id}:${roomId}`)) continue;
      seen.add(`${layer.id}:${roomId}`);
      out.push(new SetRoomLookCommand(layer.id, roomId, { [key]: undefined }));
    }
  }
  return out;
}

/** The band a floor would draw with no edge band of its own: its pinned set's or its layer's, when a band. */
export function unpinnedBandOf(o: ShapeChild): string | null {
  return edgeBandOf({ ...o, edgeBand: undefined });
}

export function fillOf(o: ShapeChild): FillValue {
  return { scale: o.textureScale, rotate: Math.round(radToDeg(o.textureFillRotation)), x: o.textureOffsetX, y: o.textureOffsetY };
}
