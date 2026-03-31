export interface ExportDimensions {
  widthPx: number;
  heightPx: number;
  clampedToLimit: boolean;
}

const MAX_EXPORT_PX = 8192;

/**
 * Compute pixel dimensions for export given grid cell counts and px-per-cell.
 * Clamps each axis to MAX_EXPORT_PX and returns whether clamping occurred.
 */
export function computeExportDimensions(
  cellWidth: number,
  cellHeight: number,
  pxPerCell: number,
): ExportDimensions {
  // Ceil fractional cells first, then multiply by pixels per cell
  const rawW = Math.ceil(cellWidth) * pxPerCell;
  const rawH = Math.ceil(cellHeight) * pxPerCell;
  const widthPx = Math.min(rawW, MAX_EXPORT_PX);
  const heightPx = Math.min(rawH, MAX_EXPORT_PX);
  return { widthPx, heightPx, clampedToLimit: rawW > MAX_EXPORT_PX || rawH > MAX_EXPORT_PX };
}

/**
 * Build the auto-filename: `{mapName}-{W}x{H}-{pxPerCell}ppc.{format}`.
 * Sanitizes map name by replacing spaces/slashes with hyphens.
 */
export function buildExportFilename(
  mapName: string,
  widthPx: number,
  heightPx: number,
  pxPerCell: number,
  format: 'png' | 'jpeg',
): string {
  const safe = mapName.trim().replace(/[\s/\\]+/g, '-') || 'map';
  return `${safe}-${widthPx}x${heightPx}-${pxPerCell}ppc.${format}`;
}

/**
 * Convert world-space bounds (in world units) to grid cell counts.
 * Each world unit = 1 grid cell.
 */
export function worldBoundsToCells(worldBounds: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): { cellWidth: number; cellHeight: number } {
  return {
    cellWidth: Math.max(1, Math.ceil(worldBounds.maxX - worldBounds.minX)),
    cellHeight: Math.max(1, Math.ceil(worldBounds.maxY - worldBounds.minY)),
  };
}
