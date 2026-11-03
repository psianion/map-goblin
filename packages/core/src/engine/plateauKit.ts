// Which art a cliff is laid with. A cliff walks the cave ink LEDGE family, not the rock band:
// straights, bends at 15° steps and two run ends, all shipped in a band set (gg-forge's
// GG_Cave_Ink). Joined by `material` + `gridSize`, the kit's key, like the rock band.

import { bandSetArt, getBandSetIds, type CatalogEntry } from '../assets/packCatalog';
import { kitPieces, ledgePieces, mirrorPiece, type CaveKitPiece } from '../assets/caveWallKit';

/** The band set a cliff takes when its floor names none. */
export const DEFAULT_CLIFF_SET = 'GG_Cave_Ink';

/** Band sets that carry ledge straights: what the card's Cliff art picker offers. */
export function cliffArtSetIds(): string[] {
  return getBandSetIds().filter((id) => getEntriesForSet(id).some((e) => e.material === 'ledge'));
}

function getEntriesForSet(setId: string): CatalogEntry[] {
  return [...bandSetArt(setId).values()];
}

/** The ledge art for a cliff set, keyed `material_gridSize`. Empty when nothing is installed. */
export function cliffArt(setId: string | undefined): Map<string, CatalogEntry> {
  const art = new Map<string, CatalogEntry>();
  for (const [key, e] of bandSetArt(setId || DEFAULT_CLIFF_SET)) if (e.material.startsWith('ledge')) art.set(key, e);
  return art;
}

/** The kit pieces a cliff can lay with `art`: only those with a picture to show. */
export function cliffPieces(art: Map<string, CatalogEntry>): CaveKitPiece[] {
  const pieces = ledgePieces().filter((p) => art.has(p.key));
  // Straights alone can fence a ring; bends alone cannot run.
  return pieces.some((p) => p.turnDeg === 0) ? pieces : [];
}

/** The pieces that end an open ledge run, with art in `art`: a tapering tail and a knot. */
export function ledgeEndPieces(art: Map<string, CatalogEntry>): CaveKitPiece[] {
  return kitPieces('ledge_end_').filter((p) => art.has(p.key));
}

/** The contour art of a set: the ledge line at half weight, broken, ticked on its low side. */
export function contourArt(setId: string | undefined): Map<string, CatalogEntry> {
  const art = new Map<string, CatalogEntry>();
  for (const [key, e] of bandSetArt(setId || DEFAULT_CLIFF_SET)) if (e.material.startsWith('contour')) art.set(key, e);
  return art;
}

/**
 * The contour kit a slope can lay with `art`: the straights (mirrors included) and the bends as
 * drawn. A bend is not reversed: its ticks are on its low side, so walked the other way they
 * would face up the slope. A corner turning against the bends is taken by straights.
 */
export function contourPieces(art: Map<string, CatalogEntry>): CaveKitPiece[] {
  const straights = kitPieces('contour_').filter((p) => p.turnDeg === 0 && art.has(p.key));
  if (straights.length === 0) return [];
  const bends = kitPieces('contour_bend_').filter((p) => art.has(p.key));
  return [...straights, ...straights.map(mirrorPiece), ...bends];
}
