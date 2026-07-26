import Database from 'better-sqlite3';
import type { AssetMetadata } from '../types.js';

export class CatalogDB {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        source_file TEXT NOT NULL,
        type TEXT NOT NULL,
        theme TEXT NOT NULL DEFAULT '',
        material TEXT NOT NULL,
        grid_size TEXT NOT NULL,
        piece_type TEXT NOT NULL,
        variant TEXT NOT NULL,
        tint TEXT NOT NULL,
        tool TEXT NOT NULL,
        tileable INTEGER NOT NULL DEFAULT 0,
        transparency INTEGER NOT NULL DEFAULT 0,
        content_bounds TEXT NOT NULL,
        perceptual_hash TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_type ON assets(type);
      CREATE INDEX IF NOT EXISTS idx_material ON assets(material);
      CREATE INDEX IF NOT EXISTS idx_theme ON assets(theme);
    `);
  }

  upsert(meta: AssetMetadata): void {
    const stmt = this.db.prepare(`
      INSERT INTO assets (id, source_file, type, theme, material, grid_size, piece_type,
        variant, tint, tool, tileable, transparency, content_bounds, perceptual_hash, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_file=excluded.source_file, type=excluded.type, theme=excluded.theme,
        material=excluded.material, grid_size=excluded.grid_size, piece_type=excluded.piece_type,
        variant=excluded.variant, tint=excluded.tint, tool=excluded.tool,
        tileable=excluded.tileable, transparency=excluded.transparency,
        content_bounds=excluded.content_bounds, perceptual_hash=excluded.perceptual_hash,
        width=excluded.width, height=excluded.height
    `);

    stmt.run(
      meta.id,
      meta.sourceFile,
      meta.type,
      meta.theme,
      meta.material,
      meta.gridSize,
      meta.pieceType,
      meta.variant,
      meta.tint,
      JSON.stringify(meta.tool),
      meta.tileable ? 1 : 0,
      meta.transparency ? 1 : 0,
      JSON.stringify(meta.contentBounds),
      meta.perceptualHash,
      meta.width,
      meta.height,
    );
  }

  getById(id: string): AssetMetadata | null {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToMeta(row) : null;
  }

  getAll(): AssetMetadata[] {
    const rows = this.db.prepare('SELECT * FROM assets').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToMeta(r));
  }

  /** @internal Used by query helpers — do not pass user-provided SQL. */
  query(sql: string, params: unknown[]): AssetMetadata[] {
    const rows = this.db.prepare(sql).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToMeta(r));
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }

  private safeJsonParse<T>(raw: unknown, fallback: T): T {
    if (typeof raw !== 'string') return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private rowToMeta(row: Record<string, unknown>): AssetMetadata {
    return {
      id: typeof row.id === 'string' ? row.id : '',
      sourceFile: typeof row.source_file === 'string' ? row.source_file : '',
      type: typeof row.type === 'string' ? (row.type as AssetMetadata['type']) : 'floor',
      theme: typeof row.theme === 'string' ? row.theme : '',
      material: typeof row.material === 'string' ? row.material : '',
      gridSize: typeof row.grid_size === 'string' ? (row.grid_size as AssetMetadata['gridSize']) : '1x1',
      pieceType: typeof row.piece_type === 'string' ? (row.piece_type as AssetMetadata['pieceType']) : 'base',
      variant: typeof row.variant === 'string' ? row.variant : '',
      tint: typeof row.tint === 'string' ? row.tint : '#000000',
      tool: this.safeJsonParse<AssetMetadata['tool']>(row.tool, []),
      tileable: typeof row.tileable === 'number' ? row.tileable === 1 : false,
      transparency: typeof row.transparency === 'number' ? row.transparency === 1 : false,
      contentBounds: this.safeJsonParse<AssetMetadata['contentBounds']>(
        row.content_bounds,
        { x: 0, y: 0, w: 0, h: 0 },
      ),
      perceptualHash: typeof row.perceptual_hash === 'string' ? row.perceptual_hash : '',
      width: typeof row.width === 'number' ? row.width : 0,
      height: typeof row.height === 'number' ? row.height : 0,
    };
  }
}
