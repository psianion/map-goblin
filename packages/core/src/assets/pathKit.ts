// The Path tool's pieces: the installed packs' path units, each a wall set's 'path' piece
// (gg-forge ships GG_Fieldstone's and GG_Palisade's straight path units). A unit is laid
// as it is, at its own length along the line; its size comes from its opaque content.

import { GRID_CELL_PX, getCatalogEntry, getEntriesByType, type CatalogEntry } from './packCatalog';
import type { UnitSize } from '../shared/pathway';

/** Every installed path unit, wall set by wall set. */
export function pathPieces(): CatalogEntry[] {
  return getEntriesByType('wall')
    .filter((e) => e.pieceType === 'path')
    .sort((a, b) => (a.set ?? '').localeCompare(b.set ?? '') || a.id.localeCompare(b.id));
}

/** The unit a path draws with: its own, else the first installed; undefined when none is. */
export function pathPieceOf(pieceId: string | null | undefined): CatalogEntry | undefined {
  return (pieceId ? getCatalogEntry(pieceId) : undefined) ?? pathPieces()[0];
}

/** What a piece is called on its swatch: its set, as a DM reads it (GG_Fieldstone → Fieldstone). */
export function pathPieceLabel(entry: CatalogEntry): string {
  return (entry.set ?? entry.label).replace(/^GG_/, '').replace(/_/g, ' ');
}

/** A unit's size in cells: its content's, or its cell's when it ships unpadded. */
export function unitSizeOf(entry: CatalogEntry): UnitSize {
  const w = entry.contentRect?.w ?? entry.naturalWidth;
  const h = entry.contentRect?.h ?? entry.naturalHeight;
  return { length: w / GRID_CELL_PX, width: h / GRID_CELL_PX };
}
