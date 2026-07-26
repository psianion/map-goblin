import type { CatalogDB } from './db.js';
import type { AssetMetadata, AssetType } from '../types.js';

export function queryByType(db: CatalogDB, type: AssetType): AssetMetadata[] {
  return db.query('SELECT * FROM assets WHERE type = ?', [type]);
}

export function queryByMaterial(
  db: CatalogDB,
  materialPrefix: string,
): AssetMetadata[] {
  return db.query('SELECT * FROM assets WHERE material LIKE ?', [
    materialPrefix + '%',
  ]);
}

export function queryByTheme(db: CatalogDB, theme: string): AssetMetadata[] {
  return db.query('SELECT * FROM assets WHERE theme = ?', [theme]);
}
