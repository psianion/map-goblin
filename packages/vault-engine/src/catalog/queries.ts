import type { CatalogDB } from './db.js';
import type { AssetMetadata, AssetType } from '../types.js';

export function queryByType(db: CatalogDB, type: AssetType): AssetMetadata[] {
  return db.byType(type);
}

export function queryByMaterial(
  db: CatalogDB,
  materialPrefix: string,
): AssetMetadata[] {
  return db.byMaterial(materialPrefix);
}

export function queryByTheme(db: CatalogDB, theme: string): AssetMetadata[] {
  return db.byTheme(theme);
}
