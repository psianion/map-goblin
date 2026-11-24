// Where a door hangs and which door kits the installed packs ship: what the door card reads.

import { useStore } from '@/store/store';
import { selectChildById, selectLayerForChild } from '@/store/selectors';
import type { DoorChild, DoorStyle, DungeonLayer, MapBuilderStore } from '@/store/types';
import { doorStyleLabel } from '@dnd/core/src/engine/tools/DoorTool';
import { doorOpeningLimit, resolveDoors, resolveWalls } from '@dnd/core/src/shared/wallResolve';
import { doorwayRoom } from '@dnd/core/src/shared/doorwaySeal';
import { doorWallLook } from '@dnd/core/src/engine/doorRenderer';
import { doorKitIds, doorKitKey, doorKitById, doorKitOf, isKitStyle, type DoorKit, type DoorKitId } from '@dnd/core/src/assets/doorKits';
import { getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { edgeStyles, ringStyles } from '@dnd/core/src/shared/wallLook';
import { layerDrawStyle, layerLevelLook } from '@dnd/core/src/engine/levelLook';
import { doorMaterialOptions } from '@/editor/models/selectionModel';
import type { Swatch } from '@/editor/SwatchPicker';
import { editChildren } from './cardWrites';

export const state = () => useStore.getState() as MapBuilderStore;

/**
 * What a Style control offers: the door styles, and "Opening", which is stored as an archway
 * flagged bare (`DoorChild.bare`): a gap in the wall or the cave's rock with nothing drawn in it.
 */
export type DoorStyleChoice = DoorStyle | 'opening';

export const doorStyleChoice = (style: DoorStyle, bare: boolean | undefined): DoorStyleChoice =>
  bare && style === 'archway' ? 'opening' : style;

/** The style a choice is stored as. */
export const choiceStyle = (choice: DoorStyleChoice): DoorStyle => (choice === 'opening' ? 'archway' : choice);

export const doorStyleChoiceLabel = (choice: DoorStyleChoice): string =>
  choice === 'opening' ? 'Opening' : doorStyleLabel(choice);

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

/** The entry a kit's swatch pictures: a pack kit's whole leaf, else a slice of its leaf from the first installed pack that ships it. */
function kitArt(kit: DoorKit, packs: readonly { packId: string }[]): string | undefined {
  if (kit.whole) return getCatalogEntry(kit.whole.leaf) ? kit.whole.leaf : undefined;
  const key = doorKitKey(kit, 'tile-a');
  const pack = packs.find((p) => getCatalogEntry(`${p.packId}:${key}`) !== undefined);
  return pack ? `${pack.packId}:${key}` : undefined;
}

/** The door kits an installed pack ships the leaf art for. */
export function installedDoorKits(s: Pick<MapBuilderStore, 'packs'> = state()): DoorKitId[] {
  const packs = s.packs.installedPacks;
  return doorKitIds().filter((id) => {
    const kit = doorKitById(id);
    return kit !== null && kitArt(kit, packs) !== undefined;
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

/**
 * The kit swatches: Auto (the wall's kit, a plain tile), then each kit an installed pack
 * ships, pictured by a slice of its leaf (a pack's kit by its whole leaf). The slices are grey
 * masters, so the kit's tint is laid over the picture: without it stone and wood look the same.
 */
export function doorKitSwatches(s: Pick<MapBuilderStore, 'packs'>, wallSetId: string | undefined): Swatch[] {
  const kits = installedDoorKits(s);
  return doorMaterialOptions(wallSetId)
    .filter((o) => o.value === 'auto' || kits.includes(o.value as DoorKitId))
    .map((o) => {
      const kit = doorKitById(o.value);
      if (!kit) return { value: o.value, label: o.label };
      return { value: o.value, label: o.label, art: kitArt(kit, s.packs.installedPacks), tint: kit.tint };
    });
}

/** The picked doors a kit can build (single and double), as the Kit column writes them. */
export function pickedKitDoors(s: MapBuilderStore): DoorChild[] {
  return s.selection.selectedIds.flatMap((id) => {
    const c = selectChildById(s, id);
    return c?.childType === 'door' && isKitStyle(c.style) ? [c] : [];
  });
}

/**
 * A kit picked in the dock: with doors picked it is their kit, one undo step, as the card's
 * Material writes it; with none it is the kit the next doors are built from. Auto clears either.
 */
export function pickDoorKit(value: string): void {
  const s = useStore.getState() as MapBuilderStore;
  const kit = doorKitById(value)?.id;
  const doors = pickedKitDoors(s);
  if (doors.length === 0) {
    s.updateToolSettings({ doorKit: kit });
    return;
  }
  editChildren('Door material', doors.map((d) => d.id), (c) => (c.childType === 'door' ? { kit } : null));
}
