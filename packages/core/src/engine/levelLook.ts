import type { DungeonLayer, DungeonStyle, Layer, RoomLook } from '../store/types';
import { useStore } from '../store/store';
import { levelOf } from '../shared/lookScope';
import { levelFloorTextureId, levelStyle } from '../shared/wallLook';

/*
 * The live store's side of a layer's level look, for the renderers and the stone
 * editors: everything that draws or lays out a layer's walls and floors reads the
 * level through here, so they all apply the one rule in wallLook.ts.
 */

/** The look of the level `layer` belongs to, from the store (undefined when it pins nothing). */
export function layerLevelLook(layer: Pick<Layer, 'levelId'>): RoomLook | undefined {
  return levelOf(useStore.getState().levels ?? [], layer).look;
}

/** The style `layer` draws with: its own, with its level's look folded in. */
export function layerDrawStyle(layer: DungeonLayer): DungeonStyle {
  return levelStyle(layer.style, layerLevelLook(layer));
}

/** The texture `layer`'s untextured floors paint with: the level's, when the layer names none. */
export function layerFloorFallback(layer: DungeonLayer): string | undefined {
  return levelFloorTextureId(layer.style, layerLevelLook(layer));
}
