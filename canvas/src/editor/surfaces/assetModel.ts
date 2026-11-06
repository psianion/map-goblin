// What the asset panel lists, from the pack catalogue the old browsers read: one chip per
// kind of art, entries grouped by pack, a Used filter over what the map already holds.
// Pure, so it is tested without a renderer.

import {
  getBandSet,
  getBandSetIds,
  getEntriesByType,
  getWallSet,
  getWallSetIds,
  propEntries,
  type CatalogEntry,
} from '@dnd/core/src/assets/packCatalog';
import type { Layer } from '@/store/types';
import type { AssetTypeFilter } from '@/editor/assetTypeFilter';
import { categoryLabel, familyTiles, searchProps, usedOnMap } from '@/v2/editor/propLibrary';

export type AssetChip = 'textures' | 'props' | 'walls' | 'paths' | 'lights';

export const ASSET_CHIPS: readonly { id: AssetChip; label: string }[] = [
  { id: 'textures', label: 'Textures' },
  { id: 'props', label: 'Props' },
  { id: 'walls', label: 'Walls' },
  { id: 'paths', label: 'Paths' },
  { id: 'lights', label: 'Lights' },
];

/** The chip a trigger's type opens on: a card's Change asks for floors, the Objects tools for props. */
export function chipFor(type: AssetTypeFilter | undefined): AssetChip {
  switch (type) {
    case 'object':
    case 'scatter':
      return 'props';
    case 'wall':
      return 'walls';
    case 'path':
      return 'paths';
    default:
      return 'textures';
  }
}

/** One tile: what a click picks, the name under it, the pack it comes from. */
export interface AssetTile {
  key: string;
  id: string;
  name: string;
  packId: string;
}

/** A wall set as one tile, picked by its first piece. */
function setTile(setId: string, pieces: readonly CatalogEntry[]): AssetTile | null {
  const rep = pieces[0];
  return rep ? { key: `set:${setId}`, id: rep.id, name: categoryLabel(setId), packId: rep.packId } : null;
}

/** The tiles for a chip, searched. Props and walls show one tile per family or set. */
export function assetTiles(chip: AssetChip, query: string): AssetTile[] {
  switch (chip) {
    case 'textures':
      return searchProps(getEntriesByType('floor'), query).map((e) => ({ key: e.id, id: e.id, name: e.label, packId: e.packId }));
    case 'paths':
      return searchProps(getEntriesByType('path'), query).map((e) => ({ key: e.id, id: e.id, name: e.label, packId: e.packId }));
    case 'props':
      return familyTiles(searchProps(propEntries(), query)).map((t) => ({ key: t.key, id: t.rep.id, name: t.rep.label, packId: t.rep.packId }));
    case 'walls': {
      const q = query.trim().toLowerCase();
      const sets = [
        ...getWallSetIds().map((id) => setTile(id, getWallSet(id))),
        ...getBandSetIds().map((id) => setTile(id, getBandSet(id))),
      ].filter((t): t is AssetTile => t !== null);
      return q ? sets.filter((t) => t.name.toLowerCase().includes(q)) : sets;
    }
    case 'lights':
      // No pack ships light art yet; the chip stays so the library reads the same when one does.
      return [];
  }
}

/** Every pack asset the map already uses: placed props and floor textures. */
export function usedIds(layers: readonly Layer[]): Set<string> {
  const out = new Set(usedOnMap(layers).keys());
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) if (c.childType === 'shape' && c.textureId) out.add(c.textureId);
  }
  return out;
}

/** Tiles under their pack, packs in the order they first appear. */
export function byPack(tiles: readonly AssetTile[]): { packId: string; tiles: AssetTile[] }[] {
  const out = new Map<string, AssetTile[]>();
  for (const t of tiles) {
    const list = out.get(t.packId);
    if (list) list.push(t);
    else out.set(t.packId, [t]);
  }
  return [...out].map(([packId, list]) => ({ packId, tiles: list }));
}
