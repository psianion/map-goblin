// Which art a cliff is laid with: one of two ledge families of a band set (gg-forge's
// GG_Cave_Ink), walked like the rock band. "Cave rock" is the stone row (`rockledge_*`), laid
// with the rock band's laps; "Cave ink line" is the thin ink ledge (`ledge_*`), laid on the edge
// itself. Joined by `material` + `gridSize`, the kit's key, like the rock band.

import { bandSetArt, type CatalogEntry } from '../assets/packCatalog';
import { kitPieces, ledgePieces, mirrorPiece, type CaveKitPiece } from '../assets/caveWallKit';

/** The band set a cliff takes when its plateau names none. */
export const DEFAULT_CLIFF_SET = 'GG_Cave_Ink';
/** The ledge family a cliff takes when its plateau names none: the cave rock row. */
export const DEFAULT_CLIFF_FAMILY = 'rockledge';

/** What a plateau's `edgeArt` asks for: `<set>:<family>`, a bare set (its rock row), or nothing. */
export interface CliffChoice {
  setId: string;
  family: string;
}

/** The set and ledge family `edgeArt` names. Absent, or a bare set id from before the choice, is Cave rock. */
export function cliffChoice(edgeArt: string | undefined): CliffChoice {
  const [setId, family] = (edgeArt ?? '').split(':');
  return { setId: setId || DEFAULT_CLIFF_SET, family: family || DEFAULT_CLIFF_FAMILY };
}

/** The two cliff looks the card offers, as `edgeArt` values: Cave rock is the default, stored as nothing. */
export const CLIFF_ART_CHOICES: readonly { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'Cave rock' },
  { value: `${DEFAULT_CLIFF_SET}:ledge`, label: 'Cave ink line' },
];

/** The ledge art a cliff's `edgeArt` names, keyed `material_gridSize`. Empty when nothing is installed. */
export function cliffArt(edgeArt: string | undefined): Map<string, CatalogEntry> {
  const { setId, family } = cliffChoice(edgeArt);
  const art = new Map<string, CatalogEntry>();
  for (const [key, e] of bandSetArt(setId)) {
    if (e.material === family || e.material.startsWith(`${family}_`)) art.set(key, e);
  }
  return art;
}

/** The kit pieces a cliff can lay with `art`: its family's, only those with a picture to show. */
export function cliffPieces(art: Map<string, CatalogEntry>, edgeArt?: string): CaveKitPiece[] {
  const pieces = ledgePieces(cliffChoice(edgeArt).family).filter((p) => art.has(p.key));
  // Straights alone can fence a ring; bends alone cannot run.
  return pieces.some((p) => p.turnDeg === 0) ? pieces : [];
}

/** The pieces that end an open ledge run of the family `edgeArt` names, with art in `art`. */
export function ledgeEndPieces(art: Map<string, CatalogEntry>, edgeArt?: string): CaveKitPiece[] {
  return kitPieces(`${cliffChoice(edgeArt).family}_end_`).filter((p) => art.has(p.key));
}

/** The contour art of a set: the ledge line at half weight, broken, ticked on its low side. */
export function contourArt(edgeArt: string | undefined): Map<string, CatalogEntry> {
  const art = new Map<string, CatalogEntry>();
  for (const [key, e] of bandSetArt(cliffChoice(edgeArt).setId)) if (e.material.startsWith('contour')) art.set(key, e);
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
