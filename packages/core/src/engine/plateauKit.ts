// Which art a cliff is laid with: one of two ledge families of a band set (gg-forge's
// GG_Cave_Ink), walked like the rock band. "Cave rock" is the stone row (`rockledge_*`), laid
// with the rock band's laps; "Cave ink line" is the thin ink ledge (`ledge_*`), laid on the edge
// itself. Joined by `material` + `gridSize`, the kit's key, like the rock band.
//
// "Painted border" lays no ledge at all: a band of a floor texture just inside the outline
// (plateauRenderer's drawPaintedBorder). Its `edgeArt` is `paint` (the default texture) or
// `paint:<texture id>`; its width is the plateau's `borderWidth`.

import { bandSetArt, getBandSetIds, getEntriesByType, type CatalogEntry } from '../assets/packCatalog';
import { kitPieces, ledgePieces, mirrorPiece, type CaveKitPiece } from '../assets/caveWallKit';
import { outdoorFloorChoices } from '../assets/materialKit';

/** The band set a cliff takes when its plateau names none. */
export const DEFAULT_CLIFF_SET = 'GG_Cave_Ink';
/** The ledge family a cliff takes when its plateau names none: the cave rock row. */
export const DEFAULT_CLIFF_FAMILY = 'rockledge';
/** The `edgeArt` of a painted border with the default texture; `paint:<texture id>` names one. */
export const PAINTED_BORDER = 'paint';

/** What a plateau's `edgeArt` asks for: `<set>:<family>`, a bare set (its rock row), or nothing. */
export interface CliffChoice {
  setId: string;
  family: string;
}

/** True when `edgeArt` asks for a painted border rather than ledge art. */
export function isPaintedBorder(edgeArt: string | undefined): boolean {
  return edgeArt === PAINTED_BORDER || !!edgeArt?.startsWith(`${PAINTED_BORDER}:`);
}

/** The `edgeArt` of a painted border in `textureId`. */
export function paintedBorderArt(textureId: string): string {
  return `${PAINTED_BORDER}:${textureId}`;
}

/** The texture a painted border takes when it names none: a dirt floor, else the first floor installed. */
export function defaultBorderTexture(): string | undefined {
  const floors = getEntriesByType('floor');
  return (floors.find((e) => e.tags.includes('dirt')) ?? floors[0])?.id;
}

/** The texture a painted border's `edgeArt` names, or the default one; undefined when it is no painted border. */
export function paintedBorderTexture(edgeArt: string | undefined): string | undefined {
  if (!isPaintedBorder(edgeArt)) return undefined;
  return edgeArt!.slice(PAINTED_BORDER.length + 1) || defaultBorderTexture();
}

/** The textures a painted border offers: the outdoor floors the Material brush lists, named as it names them. */
export function borderTextureChoices(): { value: string; label: string }[] {
  return outdoorFloorChoices();
}

/**
 * The set and ledge family `edgeArt` names. Absent, or a bare set id from before the choice, is
 * Cave rock; so is a painted border, which lays no ledge but whose slope contours, should the
 * edge turn to a slope, are the default set's.
 */
export function cliffChoice(edgeArt: string | undefined): CliffChoice {
  if (isPaintedBorder(edgeArt)) return { setId: DEFAULT_CLIFF_SET, family: DEFAULT_CLIFF_FAMILY };
  const [setId, family] = (edgeArt ?? '').split(':');
  return { setId: setId || DEFAULT_CLIFF_SET, family: family || DEFAULT_CLIFF_FAMILY };
}

/** What the card calls a ledge family; another family reads as its own name. */
const FAMILY_LABELS: Record<string, string> = { rockledge: 'Cave rock', ledge: 'Cave ink line' };

const capitalise = (w: string) => w[0].toUpperCase() + w.slice(1);

/** A set's name as a DM reads it: `GG_Cave_Ink` → Cave Ink. */
function setLabel(setId: string): string {
  return setId.replace(/^GG_/, '').split(/[-_\s]+/).filter(Boolean).map(capitalise).join(' ');
}

/**
 * The cliff looks the card offers, as `edgeArt` values: each installed band set's ledge
 * families (the rock row first) that have a kit to lay, then Painted border. Cave rock is the
 * default, stored as nothing. With two sets or more, each label leads with its set.
 */
export function cliffArtChoices(): { value: string | undefined; label: string }[] {
  return [...ledgeChoices(), { value: PAINTED_BORDER, label: 'Painted border' }];
}

function ledgeChoices(): { value: string | undefined; label: string }[] {
  const sets = getBandSetIds();
  const out: { value: string | undefined; label: string }[] = [];
  for (const setId of sets) {
    const families = new Set<string>();
    for (const e of bandSetArt(setId).values()) {
      const base = e.material.split('_')[0];
      if (base.endsWith('ledge')) families.add(base);
    }
    const ordered = [...families].sort((a, b) => Number(b === DEFAULT_CLIFF_FAMILY) - Number(a === DEFAULT_CLIFF_FAMILY) || a.localeCompare(b));
    for (const family of ordered) {
      const isDefault = setId === DEFAULT_CLIFF_SET && family === DEFAULT_CLIFF_FAMILY;
      const value = isDefault ? undefined : `${setId}:${family}`;
      if (cliffPieces(cliffArt(value), value).length === 0) continue;
      const label = FAMILY_LABELS[family] ?? capitalise(family);
      out.push({ value, label: sets.length > 1 ? `${setLabel(setId)} · ${label}` : label });
    }
  }
  // Nothing installed: the card still offers the two looks the default set will bring.
  if (out.length > 0) return out;
  return [
    { value: undefined, label: FAMILY_LABELS.rockledge },
    { value: `${DEFAULT_CLIFF_SET}:ledge`, label: FAMILY_LABELS.ledge },
  ];
}

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
