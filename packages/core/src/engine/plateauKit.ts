// Which art a cliff is laid with. A cliff walks the cave ink LEDGE family, not the rock band:
// the straights ship in a band set (gg-forge's GG_Cave_Ink: ledge_1x2/1x4/1x6) and the bends
// ship in gg-demo (ledge_bend_*), so a set's own ledge bends are used when it has them and
// gg-demo's otherwise. Joined by `material` + `gridSize`, the kit's key, like the rock band.

import { bandSetArt, getBandSetIds, getEntriesByType, type CatalogEntry } from '../assets/packCatalog';
import { ledgePieces, type CaveKitPiece } from '../assets/caveWallKit';

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
  if (![...art.keys()].some((k) => k.startsWith('ledge_bend_'))) {
    for (const e of getEntriesByType('object')) {
      if (e.material !== 'ledge_bend') continue;
      const key = `${e.material}_${e.gridSize}`;
      if (!art.has(key)) art.set(key, e);
    }
  }
  return art;
}

/**
 * The gg-demo bends a cliff borrows when its set ships none: the one-cell corner only. The
 * longer ones (2x1, 2x2, 3x3, 4x2) are measured, but they wander as thin S-curves across
 * whole edges, another look from the forge's thick straights, so they stay out of the walk.
 */
const BORROWED_BENDS = new Set(['ledge_bend_1x1']);

/** The kit pieces a cliff can lay with `art`: only those with a picture to show. */
export function cliffPieces(art: Map<string, CatalogEntry>): CaveKitPiece[] {
  const usable = (key: string): boolean => {
    const e = art.get(key);
    if (!e) return false;
    // A set's own bends (tagged cave, like its straights) are all laid; borrowed ones are picked.
    return !key.startsWith('ledge_bend_') || e.tags.includes('cave') || BORROWED_BENDS.has(key);
  };
  const pieces = ledgePieces().filter((p) => usable(p.key));
  // Straights alone can fence a ring; bends alone cannot run.
  return pieces.some((p) => p.turnDeg === 0) ? pieces : [];
}
