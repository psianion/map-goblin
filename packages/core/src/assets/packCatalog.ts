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
  gridSize: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Opaque-content bounds within the entry's cell (walls ship padded). */
  contentRect?: EntryRect;
  label: string;
  tags: string[];
}

interface CatalogState {
  version: number;
  /** The manager the views were built from — a reset/replaced singleton must rebuild. */
  manager: unknown;
  byId: Map<string, CatalogEntry>;
  byType: Map<string, CatalogEntry[]>;
  wallSets: Map<string, CatalogEntry[]>;
}

let state: CatalogState | null = null;

function parseGridSize(gs: string): { w: number; h: number } {
  const [w, h] = gs.split('x').map((n) => parseInt(n, 10));
  return { w: w || 1, h: h || 1 };
}

function build(): CatalogState {
  const manager = getAssetPackManager();
  const byId = new Map<string, CatalogEntry>();
  const byType = new Map<string, CatalogEntry[]>();
  const wallSets = new Map<string, CatalogEntry[]>();

  for (const { packId, manifest } of manager.getPackManifests()) {
    for (const [entryId, e] of Object.entries(manifest.entries)) {
      const { w, h } = parseGridSize(e.gridSize);
      const entry: CatalogEntry = {
        id: `${packId}:${entryId}`,
        packId,
        type: e.type,
        set: e.set,
        pieceType: e.pieceType,
        gridSize: e.gridSize,
        // Atlas frames are untrimmed cells, so frame w/h IS the natural size;
        // loose entries are authored on the same cell grid.
        naturalWidth: e.frame?.w ?? w * GRID_CELL_PX,
        naturalHeight: e.frame?.h ?? h * GRID_CELL_PX,
        contentRect: e.contentRect,
        label: e.material.replace(/_/g, ' '),
        tags: e.tags,
      };
      byId.set(entry.id, entry);
      const list = byType.get(entry.type);
      if (list) list.push(entry);
      else byType.set(entry.type, [entry]);
      if (entry.type === 'wall' && entry.set) {
        const setList = wallSets.get(entry.set);
        if (setList) setList.push(entry);
        else wallSets.set(entry.set, [entry]);
      }
    }
  }

  return { version: manager.catalogVersion, manager, byId, byType, wallSets };
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
