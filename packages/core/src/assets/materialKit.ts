// What the Material brush paints with: a material is a band set (its border units, walked
// round the patch like the cave band round a floor) and the floor texture that fills it.
//
// No pack declares that pairing yet, so the set name pairs them, the way corner pieces are
// classified by letter until packs tag them: GG_Cave_Ink's fill is the floor of GG_Cave_Floor,
// the one look the forge made the two as. A band set entry tagged `fill:<entry id>` names
// its fill outright and wins over the name.
//
// A plain floor texture is a material too, named by its pack-scoped id: it fills the patch
// itself, has no border units, and its edge is drawn soft (materialRenderer.ts).

import { getBandSet, getBandSetIds, getCatalogEntry, getEntriesByType, qualifyTextureId } from './packCatalog';

/** The material a new patch takes when none is picked. */
export const DEFAULT_MATERIAL = 'GG_Cave_Ink';

/** True for a plain floor texture material. Band set ids never carry a pack prefix; texture ids always do. */
export function isTextureMaterial(id: string): boolean {
  return id.includes(':');
}

/** The installed floor textures tagged `outdoor`: the ground the brushes paint plain. */
export function outdoorFloorIds(): string[] {
  return getEntriesByType('floor').filter((e) => e.tags.includes('outdoor')).map((e) => e.id);
}

/**
 * Every material installed: the band sets (border units), then the outdoor floor textures
 * that are not already a band set's fill, so the cave floor is not offered twice.
 */
export function materialIds(): string[] {
  const sets = getBandSetIds();
  const fills = new Set(sets.map(materialFillId));
  return [...sets, ...outdoorFloorIds().filter((id) => !fills.has(id))];
}

/** True for a plain floor texture material tagged `water`: its patches get a shore. */
export function isWaterMaterial(id: string): boolean {
  return isTextureMaterial(id) && (getCatalogEntry(id)?.tags.includes('water') ?? false);
}

/** True for the deep water texture, whose patches lie sunk in their banks. */
export function isDeepWater(id: string): boolean {
  return isTextureMaterial(id) && (getCatalogEntry(id)?.material ?? id.slice(id.indexOf(':') + 1)).startsWith('wild_water_deep');
}

/** A water patch's stored shore that means no shore at all (absent means the default). */
export const SHORE_NONE = 'none';

/** The shore a water patch takes unless set: the outdoor floor tagged `dirt`. */
export function defaultShoreId(): string | undefined {
  return getEntriesByType('floor').find((e) => e.tags.includes('outdoor') && e.tags.includes('dirt'))?.id;
}

/** The texture a water patch's stored `shore` draws with; undefined for none. */
export function shoreTextureOf(shore: string | undefined): string | undefined {
  if (shore === SHORE_NONE) return undefined;
  return shore ?? defaultShoreId();
}

/** A floor name's last word that reads first: wild_grass_dark → Darker grass. */
const LEADING: Record<string, string> = { dark: 'darker', deep: 'deep', light: 'lighter' };

/** A floor texture as a DM reads it: its name without its kit's word (GG_Wild_Ground's "wild"). */
function textureLabel(id: string): string {
  const entry = getCatalogEntry(id);
  const words = (entry?.material ?? id.slice(id.indexOf(':') + 1)).split('_').filter(Boolean).map((w) => w.toLowerCase());
  const kit = entry?.set?.replace(/^GG_/, '').split(/[-_\s]+/)[0]?.toLowerCase();
  if (words.length > 1 && words[0] === kit && words.slice(1).join(' ') !== 'floor') words.shift();
  const last = words[words.length - 1];
  if (words.length > 1 && LEADING[last]) {
    words.pop();
    words.unshift(LEADING[last]);
  }
  return words.join(' ');
}

/** A material as a DM reads it: GG_Cave_Ink → Cave ink; gg-forge:wild_grass_dark_8x8_floor_A → Darker grass. */
export function materialLabel(setId: string): string {
  const label = isTextureMaterial(setId)
    ? textureLabel(setId)
    : setId.replace(/^GG_/, '').split(/[-_\s]+/).filter(Boolean).map((w) => w.toLowerCase()).join(' ');
  return label ? label[0].toUpperCase() + label.slice(1) : setId;
}

/** The name stem a painted piece takes, numbered on its layer: Water, Cave for a band set, else its texture's (Grass, Dirt). */
export function pieceNameOf(material: string): string {
  if (!isTextureMaterial(material)) return 'Cave';
  if (isWaterMaterial(material)) return 'Water';
  // The last word alone, so every grass is "Grass N" whatever its shade (Darker grass → Grass).
  const words = materialLabel(material).split(' ');
  const word = words[words.length - 1] || 'Ground';
  return word[0].toUpperCase() + word.slice(1);
}

/** How far a ground texture's edge blends into what is under it unless set, cells. */
export const GROUND_SOFT_EDGE = 0.5;

/**
 * The edge softness a new piece of `textureId` takes: outdoor ground soft, so a trail runs
 * into the grass with nothing to set; water crisp (its shore is its edge); anything else,
 * a cave floor or a dungeon floor among them, crisp.
 */
export function defaultSoftOf(textureId: string | undefined): number | undefined {
  if (!textureId || !isTextureMaterial(textureId)) return undefined;
  const tags = getCatalogEntry(textureId)?.tags ?? [];
  return tags.includes('outdoor') && !tags.includes('water') ? GROUND_SOFT_EDGE : undefined;
}

/** The installed water textures: floors tagged `water`. */
export function waterTextureIds(): string[] {
  return getEntriesByType('floor').filter((e) => e.tags.includes('water')).map((e) => e.id);
}

/** The installed outdoor ground textures that are not water: what the Terrain entry of the brush lists first. */
export function groundTextureIds(): string[] {
  return getEntriesByType('floor').filter((e) => e.tags.includes('outdoor') && !e.tags.includes('water')).map((e) => e.id);
}

/** The installed water texture an older map's water mask is filled with: still water before deep. */
export function defaultWaterId(): string | undefined {
  const waters = waterTextureIds();
  return waters.find((id) => !isDeepWater(id)) ?? waters[0];
}

/** The ground a new map is covered by unless another is picked: the outdoor floor tagged `grass`, else the first outdoor ground. */
export function defaultGroundId(): string | undefined {
  const grounds = getEntriesByType('floor').filter((e) => e.tags.includes('outdoor') && !e.tags.includes('water'));
  return (grounds.find((e) => e.tags.includes('grass') || /grass/i.test(e.material ?? e.id)) ?? grounds[0])?.id;
}

/** Every material as an entry of the brush lists it, its own kind first: ground for Terrain, water for Water, the band sets for Material. */
export function brushMaterialIds(kind: 'material' | 'terrain' | 'water'): string[] {
  const all = materialIds();
  if (kind === 'material') return all;
  const first = kind === 'terrain' ? groundTextureIds() : waterTextureIds();
  return [...first, ...all.filter((id) => !first.includes(id))];
}

/**
 * What an entry of the brush paints with. The Material entry paints its picked material (a
 * band set or a texture); the Terrain and Water entries each remember a texture of their
 * own, starting on the first ground texture and the still water.
 */
export function brushMaterial(
  s: { material: string; groundMaterial?: string; waterMaterial?: string },
  kind: 'material' | 'terrain' | 'water',
): string {
  if (kind === 'terrain') return s.groundMaterial ?? defaultGroundId() ?? s.material;
  if (kind === 'water') return s.waterMaterial ?? defaultWaterId() ?? s.material;
  return s.material;
}

/** The outdoor floors, named as the Material brush names them: what a shore or a floor's painted border is laid with. */
export function outdoorFloorChoices(): { value: string; label: string }[] {
  return outdoorFloorIds().map((id) => ({ value: id, label: materialLabel(id) }));
}

/** What a water patch's shore can be: any outdoor floor, or None. */
export function shoreChoices(): { value: string; label: string }[] {
  return [...outdoorFloorChoices(), { value: SHORE_NONE, label: 'None' }];
}

/** The floor texture that fills a patch of `setId`, as a pack-scoped id; undefined for none. A texture material is its own fill. */
export function materialFillId(setId: string): string | undefined {
  if (isTextureMaterial(setId)) return setId;
  for (const e of getBandSet(setId)) {
    const tag = e.tags.find((t) => t.startsWith('fill:'));
    if (!tag) continue;
    const raw = tag.slice('fill:'.length);
    const id = raw.includes(':') ? raw : qualifyTextureId(raw);
    if (getCatalogEntry(id)) return id;
  }
  const stem = setId.replace(/_[^_]+$/, '');
  if (stem === setId) return undefined;
  return getEntriesByType('floor').find((e) => e.set === `${stem}_Floor`)?.id;
}
