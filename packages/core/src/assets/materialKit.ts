// What the Material brush paints with: a material is a band set (its border units, walked
// round the patch like the cave band round a floor) and the floor texture that fills it.
//
// No pack declares that pairing yet, so the set name pairs them, the way corner pieces are
// classified by letter until packs tag them: GG_Cave_Ink's fill is the floor of GG_Cave_Floor,
// the one look the forge made the two as. A band set entry tagged `fill:<entry id>` names
// its fill outright and wins over the name.

import { getBandSet, getBandSetIds, getCatalogEntry, getEntriesByType, qualifyTextureId } from './packCatalog';

/** The material a new patch takes when none is picked. */
export const DEFAULT_MATERIAL = 'GG_Cave_Ink';

/** Every material with border units installed, by band set id. */
export function materialIds(): string[] {
  return getBandSetIds();
}

/** A set id as a DM reads it: GG_Cave_Ink → Cave ink. */
export function materialLabel(setId: string): string {
  const words = setId.replace(/^GG_/, '').split(/[-_\s]+/).filter(Boolean).map((w) => w.toLowerCase());
  const label = words.join(' ');
  return label ? label[0].toUpperCase() + label.slice(1) : setId;
}

/** The floor texture that fills a patch of `setId`, as a pack-scoped id; undefined for none. */
export function materialFillId(setId: string): string | undefined {
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
