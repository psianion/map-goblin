// Where a door hangs and which door kits the installed packs ship: what the door card reads.

import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import type { DoorChild, DungeonLayer, MapBuilderStore } from '@/store/types';
import { doorOpeningLimit, resolveDoors, resolveWalls } from '@dnd/core/src/shared/wallResolve';
import { doorwayRoom } from '@dnd/core/src/shared/doorwaySeal';
import { doorWallLook } from '@dnd/core/src/engine/doorRenderer';
import { DOOR_KIT_IDS, doorKitKey, doorKitById, doorKitOf, type DoorKitId } from '@dnd/core/src/assets/doorKits';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { edgeStyles, ringStyles } from '@dnd/core/src/shared/wallLook';
import { layerDrawStyle, layerLevelLook } from '@dnd/core/src/engine/levelLook';

export const state = () => useStore.getState() as MapBuilderStore;

export interface DoorHost {
  layer: DungeonLayer;
  door: DoorChild;
  /** The widest its opening may get; Infinity for a door on no wall. */
  room: number;
  /** The set its wall resolves to, which picks the kit Auto builds it from. */
  wallSetId: string | undefined;
}

/** Where a door hangs, resolved the way the renderer builds it. */
export function doorHost(s: MapBuilderStore, doorId: string): DoorHost | null {
  const layer = selectLayerForChild(s, doorId);
  const door = layer?.children.find((c): c is DoorChild => c.id === doorId && c.childType === 'door');
  if (!layer || !door) return null;
  const walls = resolveWalls(layer);
  const resolved = resolveDoors(layer, walls).find((r) => r.door.id === doorId);
  if (!resolved?.wall) return { layer, door, room: Infinity, wallSetId: undefined };
  const look = layerLevelLook(layer);
  return {
    layer,
    door,
    room: doorwayRoom(layer, doorId) ?? doorOpeningLimit(resolved, walls),
    wallSetId: doorWallLook(resolved, layerDrawStyle(layer), ringStyles(layer, look), edgeStyles(layer, look)).setId,
  };
}

/** The door kits an installed pack ships the leaf art for. */
export function installedDoorKits(s: Pick<MapBuilderStore, 'packs'> = state()): DoorKitId[] {
  const packs = s.packs.installedPacks;
  return DOOR_KIT_IDS.filter((id) => {
    const kit = doorKitById(id);
    return kit !== null && packs.some((p) => getCatalogEntry(`${p.packId}:${doorKitKey(kit, 'tile-a')}`) !== undefined);
  });
}

/** The kit the door is built from, when an installed pack ships it; null otherwise. */
export function liveKit(o: DoorChild): DoorKitId | null {
  const host = doorHost(state(), o.id);
  const kit = doorKitOf(o, host?.wallSetId);
  return kit && installedDoorKits().includes(kit.id) ? kit.id : null;
}

/** Radians to the 0 to 180 degrees a door reads as (a door is the same turned a half turn). */
export const doorDeg = (rad: number) => ((Math.round((rad * 180) / Math.PI) % 180) + 180) % 180;
