// src/engine/mapTextureRefs.ts
// Enumerates every texture id a map references, and resolves those ids to the
// pack asset sets that need to be installed before the map can render. This is
// the bridge between "here's a map" and "here's what to fetch" — see
// AssetPackManager.ensureTexturesForMap, the entry point both apps call.

import { getBandSet, getWallSet } from '../assets/packCatalog';
import type { ManifestEntry, PackManifest } from './assetPackManager';
import type { Level, RoomLook, SerializedMapData } from '../store/types';

/**
 * Everything `collectMapTextureIds` needs from a map. A `Pick` of
 * `SerializedMapData` rather than the type itself so the live store (same
 * shape, different interface) can be passed straight in too.
 */
export type MapTextureSource = Pick<SerializedMapData, 'mapSettings' | 'layers'> & { levels?: readonly Level[] };

/**
 * Every raw texture id a map references: floor/shape fills, water + water
 * banks, light masks, door portals, the background texture, terrain palette
 * slots, and every piece of every wall material family a dungeon layer uses
 * (the layer default plus any per-wall pin).
 *
 * Floor-ring wall edits (`DungeonLayer.floorWallEdits`) carry no
 * `textureSetId` of their own — a ring always follows the layer's
 * `style.wallTextureSetId` — so there is nothing to collect there; only
 * `standaloneWalls` pin their own material.
 *
 * Tool state (e.g. `ScatterBrushSettings`) is never part of map data, so it
 * never needs skipping explicitly here.
 *
 * IDs come back exactly as authored — legacy flat ids or `packId:entryId` —
 * deduped, unresolved. Resolving them to pack entries is
 * `assetSetsForTextureIds`'s job.
 */
export function collectMapTextureIds(mapData: MapTextureSource): string[] {
  const ids = new Set<string>();
  const add = (id: string | null | undefined): void => {
    if (id) ids.add(id);
  };
  const addWallFamily = (setId: string | undefined): void => {
    if (!setId) return;
    for (const piece of getWallSet(setId)) ids.add(piece.id);
    // A cave band kit is a wall family too: the renderer lays its rock along
    // every ring of a layer that names it.
    for (const piece of getBandSet(setId)) ids.add(piece.id);
  };

  // A level, area or room look may pin a floor texture and a wall set of its own.
  const addLook = (look: RoomLook | undefined): void => {
    add(look?.floorTextureId);
    addWallFamily(look?.wallTextureSetId);
  };

  for (const id of mapData.mapSettings.terrain?.palette ?? []) add(id);
  for (const level of mapData.levels ?? []) addLook(level.look);

  for (const layer of mapData.layers) {
    if (layer.type === 'dungeon') {
      add(layer.style.defaultTextureId);
      addWallFamily(layer.style.wallTextureSetId);
      for (const wall of layer.standaloneWalls) addWallFamily(wall.textureSetId);
      for (const room of layer.rooms ?? []) addLook(room.look);
      for (const area of layer.areas ?? []) addLook(area.look);

      for (const child of layer.children) {
        switch (child.childType) {
          case 'shape': {
            add(child.textureId);
            // A floor a preset pinned keeps its outline's wall set (wallLook.ts
            // ringStyles), which may not be the layer's.
            const pinned = child.styleOverrides?.wallTextureSetId;
            if (typeof pinned === 'string') addWallFamily(pinned);
            break;
          }
          case 'water':
            add(child.textureId);
            add(child.bankTextureId);
            break;
          case 'door':
            add(child.portalTextureId);
            break;
          default:
            break;
        }
      }
    } else if (layer.type === 'background') {
      add(layer.backgroundTexture);
    }
  }

  return [...ids];
}

/**
 * Resolve texture ids to the asset sets they need, grouped by pack.
 *
 * Setless entries and ids that don't resolve to a known manifest entry are
 * ignored on purpose — an id that resolves but has no `set` is base art that
 * ships with every install, and an id that doesn't resolve at all is either an
 * imported-image id or unknown. Either way there's no set to fetch for it.
 */
export function resolveAssetSets(
  ids: string[],
  manifests: Array<{ packId: string; manifest: PackManifest }>,
): Map<string, Set<string>> {
  const manifestByPack = new Map(manifests.map((m) => [m.packId, m.manifest]));
  const result = new Map<string, Set<string>>();

  for (const rawId of ids) {
    const sep = rawId.indexOf(':');
    let packId: string;
    let entryId: string;
    if (sep === -1) {
      // A bare id saved before it carried a pack prefix (the water textures):
      // the first pack that has an entry by that name owns it.
      const owner = manifests.find((m) => m.manifest.entries[rawId]);
      if (!owner) continue;
      packId = owner.packId;
      entryId = rawId;
    } else {
      packId = rawId.slice(0, sep);
      entryId = rawId.slice(sep + 1);
    }
    const entry: ManifestEntry | undefined = manifestByPack.get(packId)?.entries[entryId];
    if (!entry?.set) continue;

    let sets = result.get(packId);
    if (!sets) {
      sets = new Set();
      result.set(packId, sets);
    }
    sets.add(entry.set);
  }

  return result;
}
