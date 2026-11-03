// src/assets/packCatalog.ts
//
// Runtime asset catalog derived from the installed pack manifests. This is the
// only query surface for "what assets exist" — the old hardcoded
// textureManifest.ts is gone; every id is pack-scoped ('<packId>:<entryId>').
// Views are memoized against AssetPackManager.catalogVersion, which bumps on
// every install/uninstall/texture load, so the catalog is always current and
// cheap to query from render paths.

import { getAssetPackManager } from '../engine/assetPackInstance';
import type { EntryRect } from '../engine/assetPackManager';

/** Grid cell size in pixels (200px per cell at the pack-standard 200ppi). */
export const GRID_CELL_PX = 200;

export type WallPiece = 'straight' | 'corner' | 'joint' | 'connector' | 'ending' | 'path';

export interface CatalogEntry {
  /** Full pack-scoped id: '<packId>:<entryId>'. */
  id: string;
  packId: string;
  type: string;
  /** Asset-set name ('GG_Fieldstone', ...) — doubles as the wall-set id. */
  set?: string;
  pieceType?: string;
  /** Family slug the entry belongs to ('wall_short', 'inside_bend', ...). Grid-free
   *  by design, so `material` + `gridSize` identifies one authored piece. */
  material: string;
  gridSize: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Opaque-content bounds within the entry's cell (walls ship padded). */
  contentRect?: EntryRect;
  label: string;
  tags: string[];
  /** Variant family within `set` (written by the pack build); absent = a family of one. */
  family?: string;
}

interface CatalogState {
  version: number;
  /** The manager the views were built from — a reset/replaced singleton must rebuild. */
  manager: unknown;
  byId: Map<string, CatalogEntry>;
  /** Bare entry id -> full id, for ids saved before they carried a pack prefix. */
  byLocalId: Map<string, string>;
  byType: Map<string, CatalogEntry[]>;
  wallSets: Map<string, CatalogEntry[]>;
  /** Cave band kits by set id — rock pieces the cave walk lays along a floor ring. */
  bandSets: Map<string, CatalogEntry[]>;
  /** Variant families by `familyKeyOf`, each in cycle order (see `familyCycle`). */
  families: Map<string, CatalogEntry[]>;
  /** Lazily built `propEntries()` answer. */
  props: CatalogEntry[] | null;
}

let state: CatalogState | null = null;

function parseGridSize(gs: string): { w: number; h: number } {
  const [w, h] = gs.split('x').map((n) => parseInt(n, 10));
  return { w: w || 1, h: h || 1 };
}

function build(): CatalogState {
  const manager = getAssetPackManager();
  const byId = new Map<string, CatalogEntry>();
  const byLocalId = new Map<string, string>();
  const byType = new Map<string, CatalogEntry[]>();
  const wallSets = new Map<string, CatalogEntry[]>();
  const bandSets = new Map<string, CatalogEntry[]>();

  for (const { packId, manifest } of manager.getPackManifests()) {
    for (const [entryId, e] of Object.entries(manifest.entries)) {
      const { w, h } = parseGridSize(e.gridSize);
      const entry: CatalogEntry = {
        id: `${packId}:${entryId}`,
        packId,
        type: e.type,
        set: e.set,
        pieceType: e.pieceType,
        material: e.material,
        gridSize: e.gridSize,
        // Atlas frames are untrimmed cells, so frame w/h IS the natural size;
        // loose entries are authored on the same cell grid.
        naturalWidth: e.frame?.w ?? w * GRID_CELL_PX,
        naturalHeight: e.frame?.h ?? h * GRID_CELL_PX,
        contentRect: e.contentRect,
        label: e.material.replace(/_/g, ' '),
        tags: e.tags,
        family: e.family,
      };
      byId.set(entry.id, entry);
      if (!byLocalId.has(entryId)) byLocalId.set(entryId, entry.id);
      const list = byType.get(entry.type);
      if (list) list.push(entry);
      else byType.set(entry.type, [entry]);
      if (entry.type === 'wall' && entry.set) {
        const setList = wallSets.get(entry.set);
        if (setList) setList.push(entry);
        else wallSets.set(entry.set, [entry]);
      }
      // A cave band kit ships as `object` entries tagged `cave`, which is what
      // tells the forge's kit apart from gg-demo's structures that share the
      // family names.
      if (entry.type === 'object' && entry.set && entry.tags.includes('cave')) {
        const setList = bandSets.get(entry.set);
        if (setList) setList.push(entry);
        else bandSets.set(entry.set, [entry]);
      }
    }
  }

  // A kit the walk can lay needs every family: straights alone fence a ring
  // and bends alone cannot run.
  for (const [setId, entries] of [...bandSets]) {
    const families = new Set(entries.map((e) => e.material));
    if (!['wall_short', 'inside_bend', 'outside_bend'].every((f) => families.has(f))) {
      bandSets.delete(setId);
    }
  }

  const families = new Map<string, CatalogEntry[]>();
  for (const entry of byId.values()) {
    if (!entry.family) continue;
    const key = keyOf(entry);
    const list = families.get(key);
    if (list) list.push(entry);
    else families.set(key, [entry]);
  }
  for (const list of families.values()) list.sort(cycleOrder);

  return { version: manager.catalogVersion, manager, byId, byLocalId, byType, wallSets, bandSets, families, props: null };
}

function keyOf(entry: CatalogEntry): string {
  return entry.family ? `${entry.packId}:${entry.set ?? ''}:${entry.family}` : entry.id;
}

function gridArea(entry: CatalogEntry): number {
  const { w, h } = parseGridSize(entry.gridSize);
  return w * h;
}

/** The numbers inside a material name, in order: `cat_10_d` → [10]. */
function numericTokens(material: string): number[] {
  return material
    .split('_')
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
}

function compareTokens(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * A family's cycle order: smaller grid first, one grid size kept together, then the
 * numbers in the material name. Grid sizes stay contiguous so stepping through a
 * family visits every same-size sibling before it reaches another size.
 */
function cycleOrder(a: CatalogEntry, b: CatalogEntry): number {
  return (
    gridArea(a) - gridArea(b) ||
    a.gridSize.localeCompare(b.gridSize) ||
    compareTokens(numericTokens(a.material), numericTokens(b.material)) ||
    a.material.localeCompare(b.material) ||
    a.id.localeCompare(b.id)
  );
}

function current(): CatalogState {
  const manager = getAssetPackManager();
  if (!state || state.manager !== manager || state.version !== manager.catalogVersion) {
    state = build();
  }
  return state;
}

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return current().byId.get(id);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Display name for a newly placed (or migrated) asset child: the catalog
 * label, suffixed past the highest "label N" already among `siblingNames`
 * ("rubble small", "rubble small 2", ...). Same max-suffix rule as the layer
 * panel's nextLayerName, so deleting one never recycles a name still in use.
 * A label that already ends in a number counts on from it: the crate placed
 * after "crate 4" is "crate 5", not "crate 4 2".
 */
export function nextAssetName(assetId: string, siblingNames: readonly string[]): string {
  const label = getCatalogEntry(assetId)?.label ?? 'Asset';
  const base = label.replace(/ \d+$/, '') || label;
  const re = new RegExp(`^${escapeRegExp(base)}(?: (\\d+))?$`);
  let max = 0;
  for (const name of siblingNames) {
    const m = re.exec(name);
    if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1);
  }
  return max === 0 ? label : `${base} ${max + 1}`;
}

/**
 * The pack-scoped form of a texture id. A bare id that names an installed pack
 * entry (the water tool saved `water-still-a-01` before its art shipped in a
 * pack) comes back as `<packId>:<entryId>`; every other id comes back as given.
 */
export function qualifyTextureId(id: string): string {
  if (!id || id.includes(':')) return id;
  return current().byLocalId.get(id) ?? id;
}

/**
 * True for a pack-scoped texture id that no installed pack lists: art from a
 * retired or uninstalled pack, which will never load. The floor renderer and the
 * selection card treat a shape carrying one as untextured, so it paints (and
 * edits) its floor colour instead of a texture fallback.
 *
 * Imported images, data and blob urls are never missing here: they are not
 * catalogue entries at all. Nor is anything while the catalogue is still empty,
 * since that only means the packs have not been read yet.
 */
export function isMissingTexture(rawId: string | undefined): boolean {
  if (!rawId) return false;
  const id = qualifyTextureId(rawId);
  if (!id.includes(':') || id.startsWith('data:') || id.startsWith('blob:')) return false;
  const { byId } = current();
  return byId.size > 0 && !byId.has(id);
}

/** True when a shape's texture id names art that can be drawn. */
export function hasLiveTexture(textureId: string | undefined): boolean {
  return !!textureId && !isMissingTexture(textureId);
}

export function getEntriesByType(type: string): CatalogEntry[] {
  return current().byType.get(type) ?? [];
}

/** Wall-set ids that have at least one wall entry installed. */
export function getWallSetIds(): string[] {
  return [...current().wallSets.keys()].sort();
}

export function getWallSet(setId: string): CatalogEntry[] {
  return current().wallSets.get(setId) ?? [];
}

export function getWallPieces(setId: string, piece: WallPiece): CatalogEntry[] {
  return getWallSet(setId).filter((e) => e.pieceType === piece);
}

/**
 * Cave band kits installed, by set id ('GG_Cave_Ink', ...). A layer names one
 * as its `wallTextureSetId` exactly like a wall set; the renderer then walks
 * each floor ring with the cave walk instead of composing stones along it.
 */
export function getBandSetIds(): string[] {
  return [...current().bandSets.keys()].sort();
}

export function getBandSet(setId: string): CatalogEntry[] {
  return current().bandSets.get(setId) ?? [];
}

export function isBandSet(setId: string | undefined): boolean {
  return !!setId && current().bandSets.has(setId);
}

/**
 * The art a band set offers per kit piece, keyed the way the kit joins
 * everywhere: `material` + `gridSize` is a piece's identity.
 */
export function bandSetArt(setId: string): Map<string, CatalogEntry> {
  const art = new Map<string, CatalogEntry>();
  for (const e of getBandSet(setId)) art.set(`${e.material}_${e.gridSize}`, e);
  return art;
}

// ─── Variant families ─────────────────────────────────────

/**
 * The family an asset id belongs to: `packId:set:family`, or the id itself for an
 * entry without a family (older packs, third-party packs, imported images). The
 * family is read from the manifest, never derived here.
 */
export function familyKeyOf(id: string): string {
  const entry = getCatalogEntry(id);
  return entry ? keyOf(entry) : id;
}

/** The family in cycle order; an entry without one is a family of itself, an unknown id none. */
function familyCycle(id: string): CatalogEntry[] {
  const entry = getCatalogEntry(id);
  if (!entry) return [];
  return (entry.family && current().families.get(keyOf(entry))) || [entry];
}

/**
 * Every member of `id`'s family, `id` included: the ones sharing its grid size first
 * (swapping to those keeps the footprint), then the rest by grid area, then by the
 * numbers in the material name.
 */
export function familyMembers(id: string): CatalogEntry[] {
  const cycle = familyCycle(id);
  const gridSize = getCatalogEntry(id)?.gridSize;
  return [...cycle.filter((e) => e.gridSize === gridSize), ...cycle.filter((e) => e.gridSize !== gridSize)];
}

/**
 * The next (`1`) or previous (`-1`) member of `id`'s family, wrapping. Same-size
 * siblings are adjacent in the cycle, so stepping visits them before another size.
 * `id` itself when it has no siblings or is unknown.
 */
export function siblingOf(id: string, step: 1 | -1): string {
  const cycle = familyCycle(id);
  const at = cycle.findIndex((e) => e.id === id);
  if (at < 0 || cycle.length < 2) return id;
  return cycle[(at + step + cycle.length) % cycle.length].id;
}

/** The members of the family keyed `key` (as `familyKeyOf` gives it), in cycle order; none for an unknown key. */
export function familyOfKey(key: string): CatalogEntry[] {
  return current().families.get(key) ?? [];
}

/** Where `id` sits in the cycle `siblingOf` steps through, 1-based: the dock's "2 / 9". */
export function familyPosition(id: string): { index: number; count: number } {
  const cycle = familyCycle(id);
  return { index: cycle.findIndex((e) => e.id === id) + 1, count: cycle.length };
}

/**
 * Every placeable prop: `object` entries that are neither cave band kit rock nor a
 * piece of a wall set. The cave band kit is walked along floor rings, never stamped.
 */
export function propEntries(): CatalogEntry[] {
  const state = current();
  state.props ??= (state.byType.get('object') ?? []).filter(
    (e) => !(e.set && (state.bandSets.has(e.set) || state.wallSets.has(e.set))),
  );
  return state.props;
}

// One tuning for every set: all shipped bands are authored so 0.5 grid cells of
// visible content at the default width reads right. Per-set overrides can come
// back as manifest data if a future set needs them.
export interface WallSetDefaults {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export const WALL_SET_DEFAULTS: WallSetDefaults = {
  defaultWidth: 0.5,
  minWidth: 0.15,
  maxWidth: 1.5,
};

export function getWallSetDefaults(_setId: string): WallSetDefaults {
  return WALL_SET_DEFAULTS;
}
